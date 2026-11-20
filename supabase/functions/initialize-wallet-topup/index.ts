import { createClient } from 'npm:@supabase/supabase-js@2';

const origins=new Set(['https://movaraappng-svg.github.io','http://localhost:5173','http://127.0.0.1:5173']);
const cors=(origin:string|null)=>({'Access-Control-Allow-Origin':origin&&origins.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS',Vary:'Origin'});
const json=(data:unknown,status:number,origin:string|null)=>new Response(JSON.stringify(data),{status,headers:{...cors(origin),'Content-Type':'application/json','Cache-Control':'no-store'}});

Deno.serve(async(request)=>{
  const origin=request.headers.get('origin');
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);
  if(origin&&!origins.has(origin))return json({error:'Origin not allowed'},403,origin);
  const authorization=request.headers.get('Authorization');
  const url=Deno.env.get('SUPABASE_URL');const anon=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const key=Deno.env.get('PAYSTACK_SECRET_KEY');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!authorization?.startsWith('Bearer '))return json({error:'Sign in to add wallet funds.'},401,origin);
  if(!url||!anon||!key||!service)return json({error:'Wallet checkout is not configured.'},503,origin);
  const caller=createClient(url,anon,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
  const{data:{user}}=await caller.auth.getUser();if(!user?.email)return json({error:'A verified email is needed for checkout.'},401,origin);
  const body=await request.json().catch(()=>({}));if(typeof body?.topupId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.topupId))return json({error:'Wallet top up was not found.'},400,origin);
  const{data:rows,error:lookupError}=await caller.rpc('wallet_topup_checkout',{p_topup_id:body.topupId});
  const checkout=rows?.[0];if(lookupError||!checkout)return json({error:'This wallet top up is no longer available.'},404,origin);
  if(checkout.checkout_url)return json({authorizationUrl:checkout.checkout_url,reference:checkout.provider_reference},200,origin);
  const reference=checkout.provider_reference??`movara_wallet_${body.topupId.replaceAll('-','')}`;
  const admin=createClient(url,service,{auth:{persistSession:false}});
  if(!checkout.provider_reference){
    const{data:claimed,error}=await admin.from('payments').update({provider:'paystack',provider_reference:reference,updated_at:new Date().toISOString()})
      .eq('id',checkout.payment_id).eq('payer_id',user.id).eq('status','pending').is('provider_reference',null).select('id').maybeSingle();
    if(error)return json({error:'Wallet checkout could not be prepared.'},500,origin);
    if(!claimed){const{data:latest}=await caller.rpc('wallet_topup_checkout',{p_topup_id:body.topupId});const saved=latest?.[0];if(saved?.checkout_url)return json({authorizationUrl:saved.checkout_url,reference:saved.provider_reference},200,origin);if(saved?.provider_reference!==reference)return json({error:'Wallet checkout is already being prepared. Please retry shortly.'},409,origin);}
  }
  const callback=Deno.env.get('PAYSTACK_CALLBACK_URL')??'https://movaraappng-svg.github.io/movara/';
  const response=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,amount:checkout.amount_kobo,currency:'NGN',reference,callback_url:callback,metadata:{wallet_topup_id:body.topupId,user_id:user.id,payment_type:'wallet_topup'}})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.status||!result.data?.authorization_url){console.error('Paystack wallet initialization failed',result.message);return json({error:'Wallet checkout could not be started. Please retry shortly.'},502,origin);}
  const{error:saveError}=await admin.from('wallet_topups').update({checkout_url:result.data.authorization_url}).eq('id',body.topupId).eq('user_id',user.id).eq('status','pending');
  if(saveError)return json({error:'Wallet checkout started but could not be recorded. Please contact support before retrying.'},500,origin);
  return json({authorizationUrl:result.data.authorization_url,reference},200,origin);
});
