import { createClient } from 'npm:@supabase/supabase-js@2';
const origins = new Set(['https://movaraappng-svg.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const cors = (origin: string | null) => ({ 'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'null', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' });
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (origin && !origins.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
  const authorization = request.headers.get('Authorization'); const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const key = Deno.env.get('PAYSTACK_SECRET_KEY'); const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to verify payment.' }, 401, origin);
  if (!url || !anon || !key || !service) return json({ error: 'Payment verification is not configured.' }, 503, origin);
  const caller = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await caller.auth.getUser(); if (!user) return json({ error: 'Your session has expired.' }, 401, origin);
  let body: { reference?: string }; try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400, origin); }
  if (!body.reference || body.reference.length > 120) return json({ error: 'Payment reference is missing.' }, 400, origin);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: payment } = await admin.from('payments').select('id,ride_id,payer_id,amount_kobo,currency,status,payment_type').eq('provider', 'paystack').eq('provider_reference', body.reference).eq('payer_id', user.id).single();
  if (!payment) return json({ error: 'This payment could not be found for your account.' }, 404, origin);
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(body.reference)}`, { headers: { Authorization: `Bearer ${key}` } });
  const result = await response.json(); const transaction = result.data;
  if (!response.ok || !result.status) return json({ error: 'Paystack could not verify this transaction.' }, 502, origin);
  if (transaction?.status !== 'success' || transaction.currency !== payment.currency || Number(transaction.amount) !== Number(payment.amount_kobo)) {
    if (['failed', 'abandoned'].includes(transaction?.status)) {
      if(payment.payment_type==='wallet_topup')await admin.rpc('wallet_fail_topup',{p_payment_id:payment.id});
      else await admin.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'pending');
    }
    return json({ paid: false, pending: !['failed', 'abandoned'].includes(transaction?.status), error: 'Payment is not confirmed. You can retry after checking your bank or wallet.' }, 200, origin);
  }
  if(payment.payment_type==='wallet_topup'){
    const{data:completed,error:completionError}=await admin.rpc('wallet_complete_topup',{p_payment_id:payment.id,p_event_id:transaction.id?.toString()??body.reference});
    if(completionError||!completed)return json({error:'Payment was received but the wallet credit could not be recorded. Contact support with your reference.'},500,origin);
    return json({paid:true,wallet_topup:true},200,origin);
  }
  if (payment.status !== 'succeeded') {
    const { error } = await admin.from('payments').update({ status: 'succeeded', updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'pending');
    if (error) return json({ error: 'Payment was received but could not be recorded. Contact support with the reference.' }, 500, origin);
  }
  return json({ paid: true }, 200, origin);
});
