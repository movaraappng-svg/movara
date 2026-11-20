import { createClient } from 'npm:@supabase/supabase-js@2';
function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join(''); }
async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY'); const url = Deno.env.get('SUPABASE_URL'); const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !service) return new Response('Webhook is not configured', { status: 503 });
  const body = await request.text(); const incoming = request.headers.get('x-paystack-signature') ?? '';
  const expected = await signature(secret, body);
  let signatureDifference = incoming.length ^ expected.length;
  for (let index = 0; index < Math.max(incoming.length, expected.length); index += 1) {
    signatureDifference |= (incoming.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  if (signatureDifference !== 0) return new Response('Invalid signature', { status: 401 });
  let event: Record<string, any>;
  try { event = JSON.parse(body); } catch { return new Response('Invalid event', { status: 400 }); }
  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (['refund.pending','refund.processing','refund.processed','refund.failed'].includes(event.event)) {
    const refundReference=event.data?.reference;
    if(typeof refundReference!=='string')return new Response('Missing refund reference',{status:400});
    const{data:refund,error:refundLookupError}=await admin.from('paystack_refunds').select('id,amount_kobo,currency,status').eq('provider_reference',refundReference).maybeSingle();
    if(refundLookupError||!refund)return new Response('Refund request not found',{status:404});
    if(Number(event.data?.amount)!==Number(refund.amount_kobo)||event.data?.currency!==refund.currency)return new Response('Refund details do not match',{status:400});
    const status=event.event==='refund.processed'?'processed':event.event==='refund.failed'?'failed':event.event==='refund.processing'?'processing':'pending';
    const update={status,provider_status:status,provider_refund_id:event.data?.id?.toString()??null,updated_at:new Date().toISOString(),processed_at:status==='processed'?new Date().toISOString():null,failure_reason:status==='failed'?String(event.data?.reason??'Paystack could not process the refund').slice(0,500):null};
    const{error:updateError}=await admin.from('paystack_refunds').update(update).eq('provider_reference',refundReference).neq('status','processed');
    if(updateError){console.error('Refund webhook update failed',updateError);return new Response('Could not record refund status',{status:500});}
    return new Response('Refund status recorded',{status:200});
  }
  if(['transfer.success','transfer.failed','transfer.reversed'].includes(event.event)){
    const reference=event.data?.reference;
    if(typeof reference!=='string')return new Response('Missing transfer reference',{status:400});
    const providerStatus=event.event==='transfer.success'?'success':event.event==='transfer.reversed'?'reversed':'failed';
    const verificationResponse=await fetch(`https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${secret}`}});
    const verification=await verificationResponse.json().catch(()=>({}));
    if(!verificationResponse.ok||!verification.status||Number(verification.data?.amount)!==Number(event.data?.amount)||verification.data?.currency!=='NGN')return new Response('Transfer verification failed',{status:502});
    const verifiedStatus=String(verification.data?.status??'').toLowerCase();
    if(verifiedStatus!==providerStatus)return new Response('Transfer status is not final yet',{status:502});
    const{data:finalized,error:finalizeError}=await admin.rpc('wallet_finalize_transfer',{p_provider_reference:reference,p_provider_status:providerStatus,p_event_id:event.data?.id?.toString()??reference});
    if(finalizeError){console.error('Wallet transfer settlement failed',finalizeError);return new Response('Could not record transfer status',{status:500});}
    return new Response(finalized?'Transfer status recorded':'Unknown transfer reference',{status:finalized?200:404});
  }
  if (!['charge.success', 'charge.failed'].includes(event.event)) return new Response('Ignored', { status: 200 });
  const reference = event.data?.reference;
  if (typeof reference !== 'string') return new Response('Missing reference', { status: 400 });
  const { data: payment, error } = await admin.from('payments').select('id,ride_id,payer_id,amount_kobo,currency,status,payment_type').eq('provider', 'paystack').eq('provider_reference', reference).single();
  if (error || !payment) return new Response('Payment not found', { status: 404 });
  if (payment.status === 'succeeded') return new Response('Already recorded', { status: 200 });
  if (event.event === 'charge.failed') {
    if(payment.payment_type==='wallet_topup'){
      const{error:failError}=await admin.rpc('wallet_fail_topup',{p_payment_id:payment.id});
      return failError?new Response('Could not record failed wallet top up',{status:500}):new Response('Recorded',{status:200});
    }
    const { error: failedError } = await admin.from('payments').update({ status: 'failed', provider_event_id: event.data.id?.toString() ?? reference, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'pending');
    return failedError ? new Response('Could not record failed payment', { status: 500 }) : new Response('Recorded', { status: 200 });
  }
  if (event.data.status !== 'success' || event.data.currency !== payment.currency || Number(event.data.amount) !== Number(payment.amount_kobo)) return new Response('Payment details do not match', { status: 400 });
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
  const verified = await response.json();
  if (!response.ok || !verified.status || verified.data?.status !== 'success'
    || verified.data?.currency !== payment.currency || Number(verified.data?.amount) !== Number(payment.amount_kobo)) return new Response('Provider verification failed', { status: 400 });
  if(payment.payment_type==='wallet_topup'){
    const{data:completed,error:completionError}=await admin.rpc('wallet_complete_topup',{p_payment_id:payment.id,p_event_id:event.data.id?.toString()??reference});
    return completionError||!completed?new Response('Wallet credit could not be recorded',{status:500}):new Response('OK',{status:200});
  }
  const { error: updateError } = await admin.from('payments').update({ status: 'succeeded', provider_event_id: event.data.id?.toString() ?? reference, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'pending');
  if (updateError) { console.error('Payment confirmation update failed', updateError); return new Response('Could not record payment', { status: 500 }); }
  return new Response('OK', { status: 200 });
});
