import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://movaraappng-svg.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'null',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin',
});
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), {
  status, headers: { ...cors(origin), 'Content-Type': 'application/json' },
});

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin not allowed.' }, 403, origin);

  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const apiKey = Deno.env.get('ORS_API_KEY');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to search for a place.' }, 401, origin);
  if (!url || !anon || !apiKey) return json({ error: 'Place search is not configured yet. You can still set a pin on the map.' }, 503, origin);

  const client = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return json({ error: 'Your session has expired. Sign in again.' }, 401, origin);
  let body: { query?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400, origin); }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : '';
  if (query.length < 3) return json({ places: [] }, 200, origin);

  const endpoint = new URL('https://api.heigit.org/pelias/v1/autocomplete');
  endpoint.searchParams.set('text', query);
  endpoint.searchParams.set('boundary.country', 'NG');
  endpoint.searchParams.set('size', '5');
  try {
    const response = await fetch(endpoint, { headers: { Authorization: apiKey, Accept: 'application/json' } });
    const result = await response.json();
    if (!response.ok) {
      console.warn('HeiGIT geocoding request rejected', response.status);
      return json({ error: response.status === 429 ? 'Address search is busy. Try again shortly.' : 'Address search is temporarily unavailable.' }, 502, origin);
    }
    const places = (result.features ?? []).flatMap((feature: any) => {
      const coordinates = feature.geometry?.coordinates;
      const properties = feature.properties ?? {};
      if (!Array.isArray(coordinates) || coordinates.length < 2 || !properties.label) return [];
      const cityName = properties.locality ?? properties.localadmin ?? properties.county ?? properties.region ?? 'Nigeria';
      const country = properties.country_a ?? 'NG';
      const citySlug = String(cityName).normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
      return [{ label: String(properties.label), point: [Number(coordinates[1]), Number(coordinates[0])], cityCode: citySlug ? `${country}-${citySlug}`.slice(0, 24) : `${country}-DEFAULT`, cityName }];
    });
    return json({ places }, 200, origin);
  } catch {
    return json({ error: 'Address search is temporarily unavailable.' }, 502, origin);
  }
});
