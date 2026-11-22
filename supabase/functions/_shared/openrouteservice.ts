import type { Point, RouteResult } from './google-routes.ts';

export async function calculateOpenRouteServiceRoute(origin: Point, destination: Point, apiKey: string): Promise<RouteResult> {
  const response = await fetch('https://api.heigit.org/openrouteservice/v2/directions/driving-car', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
    body: JSON.stringify({
      coordinates: [[origin.longitude, origin.latitude], [destination.longitude, destination.latitude]],
      instructions: false,
      geometry_simplify: false,
    }),
  });
  const result = await response.json();
  const route = result.routes?.[0];
  const distanceMeters = Number(route?.summary?.distance);
  const durationSeconds = Number(route?.summary?.duration);
  const encodedPolyline = typeof route?.geometry === 'string' ? route.geometry : '';
  if (!response.ok || !encodedPolyline || !Number.isFinite(distanceMeters) || distanceMeters <= 0
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    console.warn('OpenRouteService request rejected', response.status, result.error?.code ?? result.error?.message);
    if (response.status === 429) throw new Error('Routing is busy. Please try again shortly.');
    throw new Error('A driving route could not be found for these points.');
  }
  return {
    encodedPolyline, distanceMeters, durationSeconds,
    distanceText: `${(distanceMeters / 1000).toFixed(1)} km`,
    durationText: `about ${Math.max(1, Math.round(durationSeconds / 60))} min`,
  };
}
