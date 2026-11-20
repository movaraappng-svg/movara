import { createClient } from 'npm:@supabase/supabase-js@2';

const origins = new Set(['https://movaraappng-svg.github.io','http://localhost:5173','http://127.0.0.1:5173']);
const cors=(origin:string|null)=>({'Access-Control-Allow-Origin':origin&&origins.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS',Vary:'Origin'});
const json=(body:unknown,status:number,origin:string|null)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json'}});

Deno.serve(async request=>{
  const origin=request.headers.get('origin');
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);
  if(origin&&!origins.has(origin))return json({error:'Origin not allowed'},403,origin);
  const authorization=request.headers.get('Authorization');
  const url=Deno.env.get('SUPABASE_URL');const anon=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');const secret=Deno.env.get('PAYSTACK_SECRET_KEY');
  if(!authorization?.startsWith('Bearer '))return json({error:'Sign in to continue.'},401,origin);
  if(!url||!anon||!service||!secret)return json({error:'Refund processing is not configured.'},503,origin);
  const caller=createClient(url,anon,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
  const{data:{user}}=await caller.auth.getUser();if(!user)return json({error:'Your session has expired.'},401,origin);
  const{data:role}=await caller.from('user_roles').select('role').eq('user_id',user.id).eq('role','administrator').maybeSingle();
  if(!role)return json({error:'Administrator access required.'},403,origin);
  let body:{refundId?:string};try{body=await request.json();}catch{return json({error:'Invalid request.'},400,origin);}
  if(!body.refundId)return json({error:'Refund request is required.'},400,origin);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const{data:refund,error}=await admin.from('paystack_refunds').select('id,payment_id,amount_kobo,currency,customer_reason,merchant_reason,status,provider_reference').eq('id',body.refundId).single();
  if(error||!refund)return json({error:'Refund request was not found.'},404,origin);
  if(!['requested','submitting'].includes(refund.status))return json({error:`This refund is already ${refund.status}.`},409,origin);
  const{data:payment}=await admin.from('payments').select('provider_reference,status,provider,payment_type,currency').eq('id',refund.payment_id).single();
  if(!payment||payment.provider!=='paystack'||payment.status!=='succeeded'||payment.currency!==refund.currency)return json({error:'The original payment is not eligible.'},409,origin);
  await admin.from('paystack_refunds').update({status:'submitting',updated_at:new Date().toISOString(),failure_reason:null}).eq('id',refund.id).in('status',['requested','submitting']);
  let response:Response;
  try{
    response=await fetch('https://api.paystack.co/refund',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({transaction:payment.provider_reference,amount:refund.amount_kobo,currency:refund.currency,customer_note:refund.customer_reason,merchant_note:refund.merchant_reason,reference:refund.provider_reference})});
  }catch(error){console.error('Paystack refund request outcome is unknown',error);return json({error:'Paystack did not return a response. Keep this request open and reconcile it before retrying.'},502,origin);}
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.status){
    const message=String(result.message??'Paystack could not accept the refund.').slice(0,500);
    if(response.status>=500)return json({error:'Paystack returned a temporary error. The refund stays open with its original reference; reconcile it before trying again.'},502,origin);
    await admin.from('paystack_refunds').update({status:'failed',provider_status:'failed',failure_reason:message,updated_at:new Date().toISOString()}).eq('id',refund.id);
    return json({error:message},502,origin);
  }
  const providerStatus=String(result.data?.status??'pending').toLowerCase();
  const status=providerStatus==='processed'?'processed':providerStatus==='failed'?'failed':providerStatus==='processing'?'processing':'pending';
  const{error:updateError}=await admin.from('paystack_refunds').update({status,provider_status:providerStatus,provider_refund_id:result.data?.id?.toString()??null,updated_at:new Date().toISOString(),processed_at:status==='processed'?new Date().toISOString():null}).eq('id',refund.id);
  if(updateError)return json({error:'Paystack accepted the refund, but the local record could not be updated. Use the reconciliation screen.'},500,origin);
  return json({ok:true,status,reference:refund.provider_reference},200,origin);
});
