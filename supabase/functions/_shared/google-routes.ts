export type Point = { latitude: number; longitude: number };

export type RouteResult = {
  encodedPolyline: string;
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
};

export function validPoint(point: unknown): point is Point {
  if (!point || typeof point !== 'object') return false;
  const { latitude, longitude } = point as Record<string, unknown>;
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export async function calculateGoogleRoute(
  origin: Point,
  destination: Point,
  apiKey: string,
  departureTime?: string | null,
): Promise<RouteResult> {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: origin } },
    destination: { location: { latLng: destination } },
    travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', units: 'METRIC', languageCode: 'en',
  };
  if (departureTime) {
    const date = new Date(departureTime);
    if (Number.isFinite(date.getTime()) && date.getTime() > Date.now()) body.departureTime = date.toISOString();
  }
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  const route = result.routes?.[0];
  const distanceMeters = Number(route?.distanceMeters);
  const durationSeconds = typeof route?.duration === 'string' ? Number.parseFloat(route.duration.replace(/s$/, '')) : NaN;
  if (!response.ok || !route?.polyline?.encodedPolyline || !Number.isFinite(distanceMeters) || distanceMeters <= 0
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    console.warn('Google Routes request rejected', response.status, result.error?.status);
    throw new Error(response.status === 429 ? 'Live routing is busy. Try again shortly.' : 'A driving route could not be found for these points.');
  }
  return {
    encodedPolyline: route.polyline.encodedPolyline, distanceMeters, durationSeconds,
    distanceText: `${(distanceMeters / 1000).toFixed(1)} km`,
    durationText: `about ${Math.max(1, Math.round(durationSeconds / 60))} min`,
  };
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function hmacKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function signQuote(payload: Record<string, unknown>, secret: string) {
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded)));
  return `${encoded}.${base64Url(signature)}`;
}

export async function verifyQuote(token: string, secret: string) {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const key = await hmacKey(secret, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), new TextEncoder().encode(encoded));
  if (!valid) return null;
  try { return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as Record<string, unknown>; } catch { return null; }
}
