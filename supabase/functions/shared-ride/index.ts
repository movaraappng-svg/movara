import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:60948',
  'https://movaraappng-svg.github.io', 'https://movaraappng-svg.github.io/movara',
]);
function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://movaraappng-svg.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
  const { token } = await request.json().catch(() => ({}));
  if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(token)) return json({ error: 'Invalid trip link' }, 400, origin);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Trip sharing is temporarily unavailable' }, 503, origin);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: share } = await admin.from('ride_share_links').select('ride_id,expires_at,revoked_at').eq('token', token).maybeSingle();
  if (!share || share.revoked_at || new Date(share.expires_at).getTime() <= Date.now()) return json({ error: 'This trip link has expired or was turned off' }, 404, origin);
  const { data: ride } = await admin.from('rides')
    .select('id,pickup_label,destination_label,status,service_level,updated_at')
    .eq('id', share.ride_id).maybeSingle();
  if (!ride) return json({ error: 'Trip is no longer available' }, 404, origin);
  const { data: location } = ['accepted', 'in_progress'].includes(ride.status)
    ? await admin.from('ride_live_locations').select('latitude,longitude,updated_at').eq('ride_id', ride.id).maybeSingle()
    : { data: null };
  return json({ ride, location, expiresAt: share.expires_at }, 200, origin);
});
