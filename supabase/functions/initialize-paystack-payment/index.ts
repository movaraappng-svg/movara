import { createClient } from 'npm:@supabase/supabase-js@2';
const allowedOrigins = new Set(['https://movaraappng-svg.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const cors = (origin: string | null) => ({ 'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'null', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' });
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
  const authorization = request.headers.get('Authorization'); const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const key = Deno.env.get('PAYSTACK_SECRET_KEY'); const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to pay.' }, 401, origin);
  if (!url || !anon || !key || !service) return json({ error: 'Online payments are not configured yet.' }, 503, origin);
  const caller = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await caller.auth.getUser(); if (!user?.email) return json({ error: 'A verified email is needed for checkout.' }, 401, origin);
  let body: { rideId?: string; paymentType?: string }; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400, origin); }
  if (!body.rideId) return json({ error: 'Ride not found.' }, 400, origin);
  const paymentType = body.paymentType === 'cancellation_fee' ? 'cancellation_fee' : 'ride';
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: ride, error } = await admin.from('rides').select('id,customer_id,status,payment_method,estimated_fare_ngn_kobo,cancellation_fee_ngn_kobo,currency').eq('id', body.rideId).eq('customer_id', user.id).single();
  const amount = paymentType === 'ride' ? ride?.estimated_fare_ngn_kobo : ride?.cancellation_fee_ngn_kobo;
  const allowed = paymentType === 'ride'
    ? ride?.status === 'accepted' && ride?.payment_method === 'paystack'
    : ride?.status === 'cancelled' && ride?.payment_method === 'paystack';
  if (error || !ride || !allowed || !amount || amount <= 0) return json({ error: paymentType === 'ride' ? 'Online payment is available after a driver accepts this ride.' : 'There is no online cancellation fee due for this ride.' }, 409, origin);
  if ((ride.currency ?? 'NGN') !== 'NGN') return json({ error: 'Paystack checkout is currently available for Nigerian naira rides only.' }, 409, origin);
  const { data: existing } = await admin.from('payments').select('provider_reference,status,authorization_url,checkout_expires_at').eq('ride_id', ride.id).eq('payment_type', paymentType).in('status', ['pending','succeeded']).maybeSingle();
  if (existing?.status === 'succeeded') return json({ paid: true }, 200, origin);
  if (existing?.status === 'pending') {
    if (existing.authorization_url && existing.checkout_expires_at && new Date(existing.checkout_expires_at).getTime() > Date.now()) {
      return json({ authorizationUrl: existing.authorization_url, reference: existing.provider_reference }, 200, origin);
    }
    return json({ error: 'A payment is still being confirmed. Refresh your ride in a moment or contact support if you were charged.' }, 409, origin);
  }
  const reference = `movara_${paymentType === 'ride' ? 'ride' : 'cancel'}_${ride.id.replaceAll('-', '')}_${crypto.randomUUID().replaceAll('-', '')}`;
  const { data: payment, error: insertError } = await admin.from('payments').insert({ ride_id: ride.id, payer_id: user.id, payment_type: paymentType, amount_kobo: amount, currency: 'NGN', status: 'pending', provider: 'paystack', provider_reference: reference }).select('id').single();
  if (insertError || !payment) {
    console.error('Payment reservation failed', insertError);
    return json({ error: 'A checkout may already be open. Refresh your ride before trying again.' }, 409, origin);
  }
  const callback = Deno.env.get('PAYSTACK_CALLBACK_URL') ?? 'https://movaraappng-svg.github.io/movara/';
  const response = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, amount, currency: 'NGN', reference, callback_url: callback, metadata: { ride_id: ride.id, customer_id: user.id, payment_type: paymentType } }) });
  const result = await response.json();
  if (!response.ok || !result.status || !result.data?.authorization_url) {
    console.error('Paystack initialize rejected', result.message);
    await admin.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'pending');
    return json({ error: 'Checkout could not be started. Please try again.' }, 502, origin);
  }
  const { error: saveError } = await admin.from('payments').update({ authorization_url: result.data.authorization_url, checkout_expires_at: new Date(Date.now() + 25 * 60_000).toISOString() }).eq('id', payment.id).eq('status', 'pending');
  if (saveError) {
    console.error('Paystack checkout URL could not be saved', saveError);
    return json({ error: 'Checkout started but could not be attached to your ride. Contact support before retrying.' }, 500, origin);
  }
  return json({ authorizationUrl: result.data.authorization_url, reference }, 200, origin);
});
