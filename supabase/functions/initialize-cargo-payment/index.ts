import { createClient } from 'npm:@supabase/supabase-js@2';

const origins = new Set(['https://movaraappng-svg.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const cors = (origin: string | null) => ({ 'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'null', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' });
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);
  if (origin && !origins.has(origin)) return json({ error: 'Origin not allowed.' }, 403, origin);

  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to pay for this delivery.' }, 401, origin);
  if (!url || !anon || !secret || !service) return json({ error: 'Secure cargo payments are not configured yet.' }, 503, origin);

  const caller = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user?.email) return json({ error: 'A signed-in account with an email is required.' }, 401, origin);
  let body: { cargoOrderId?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid payment request.' }, 400, origin); }
  if (typeof body.cargoOrderId !== 'string' || body.cargoOrderId.length > 64) return json({ error: 'Choose a valid cargo order.' }, 400, origin);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: order, error: orderError } = await admin.from('cargo_orders')
    .select('id,sender_id,status,payment_status,quote_amount_ngn_kobo,tracking_code,country_code')
    .eq('id', body.cargoOrderId).eq('sender_id', user.id).maybeSingle();
  if (orderError || !order) return json({ error: 'This cargo order was not found for your account.' }, 404, origin);
  if (order.status !== 'accepted' || !order.quote_amount_ngn_kobo) return json({ error: 'Accept a confirmed quote before paying.' }, 409, origin);
  if (order.country_code !== 'NG') return json({ error: 'Paystack cargo checkout is currently available in Nigeria only.' }, 409, origin);
  if (order.payment_status === 'paid') return json({ paid: true }, 200, origin);

  const { data: existing } = await admin.from('payments').select('status,authorization_url,checkout_expires_at')
    .eq('cargo_order_id', order.id).eq('payment_type', 'cargo').in('status', ['pending','succeeded']).maybeSingle();
  if (existing?.status === 'succeeded') return json({ paid: true }, 200, origin);
  if (existing?.status === 'pending') {
    if (existing.authorization_url && existing.checkout_expires_at && new Date(existing.checkout_expires_at).getTime() > Date.now()) {
      return json({ authorizationUrl: existing.authorization_url }, 200, origin);
    }
    return json({ error: 'A payment is already pending. Refresh this page in a moment or contact support if you were charged.' }, 409, origin);
  }

  const reference = `movara_cargo_${order.id.replaceAll('-', '')}_${crypto.randomUUID().replaceAll('-', '')}`;
  const { data: payment, error: insertError } = await admin.from('payments').insert({
    cargo_order_id: order.id, payer_id: user.id, amount_kobo: order.quote_amount_ngn_kobo,
    currency: 'NGN', status: 'pending', provider: 'paystack', provider_reference: reference, payment_type: 'cargo',
  }).select('id').single();
  if (insertError || !payment) {
    console.error('Cargo payment reservation failed', insertError);
    return json({ error: 'A checkout may already be open. Refresh the order before retrying.' }, 409, origin);
  }

  const callback = Deno.env.get('PAYSTACK_CALLBACK_URL') ?? 'https://movaraappng-svg.github.io/movara/';
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, amount: order.quote_amount_ngn_kobo, currency: 'NGN', reference,
      callback_url: callback, metadata: { cargo_order_id: order.id, tracking_code: order.tracking_code, customer_id: user.id, payment_type: 'cargo' } }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.status || !result.data?.authorization_url) {
    console.error('Paystack rejected cargo checkout', result.message);
    await admin.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'pending');
    return json({ error: 'Secure checkout could not start. Your order is still safe; try again shortly.' }, 502, origin);
  }
  const expiresAt = new Date(Date.now() + 25 * 60_000).toISOString();
  const { error: saveError } = await admin.from('payments').update({ authorization_url: result.data.authorization_url, checkout_expires_at: expiresAt }).eq('id', payment.id);
  if (saveError) {
    console.error('Cargo checkout URL could not be saved', saveError);
    return json({ error: 'Checkout was created but could not be attached to your order. Contact support before starting another payment.' }, 500, origin);
  }
  return json({ authorizationUrl: result.data.authorization_url }, 200, origin);
});
