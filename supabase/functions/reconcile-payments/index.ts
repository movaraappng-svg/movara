import { createClient } from 'npm:@supabase/supabase-js@2';

const origins=new Set(['https://movaraappng-svg.github.io','http://localhost:5173','http://127.0.0.1:5173']);
const cors=(origin:string|null)=>({'Access-Control-Allow-Origin':origin&&origins.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS',Vary:'Origin'});
const json=(body:unknown,status:number,origin:string|null)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json'}});
type Payment={id:string,payer_id:string,ride_id:string|null,amount_kobo:number,currency:string,status:string,payment_type:string,provider_reference:string|null};

Deno.serve(async request=>{
  const origin=request.headers.get('origin');
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);
  if(origin&&!origins.has(origin))return json({error:'Origin not allowed'},403,origin);
  const authorization=request.headers.get('Authorization');const url=Deno.env.get('SUPABASE_URL');
  const anon=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');const secret=Deno.env.get('PAYSTACK_SECRET_KEY');
  if(!authorization?.startsWith('Bearer '))return json({error:'Sign in to continue.'},401,origin);
  if(!url||!anon||!service||!secret)return json({error:'Payment reconciliation is not configured.'},503,origin);
  const caller=createClient(url,anon,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
  const{data:{user}}=await caller.auth.getUser();if(!user)return json({error:'Your session has expired.'},401,origin);
  const{data:role}=await caller.from('user_roles').select('role').eq('user_id',user.id).eq('role','administrator').maybeSingle();
  if(!role)return json({error:'Administrator access required.'},403,origin);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const{data:run,error:runError}=await admin.from('payment_reconciliation_runs').insert({requested_by:user.id}).select('id').single();
  if(runError||!run)return json({error:'Could not start reconciliation.'},500,origin);
  const{data:payments,error:paymentError}=await admin.from('payments').select('id,payer_id,ride_id,amount_kobo,currency,status,payment_type,provider_reference').eq('provider','paystack').not('provider_reference','is',null).in('status',['pending','succeeded','failed']).order('updated_at',{ascending:false}).limit(100);
  if(paymentError||!payments){await admin.from('payment_reconciliation_runs').update({status:'failed',error_summary:'Could not load payment records.',completed_at:new Date().toISOString()}).eq('id',run.id);return json({error:'Could not load payment records.'},500,origin);}
  const items=[];let mismatchCount=0;let checkedCount=0;
  for(const payment of payments as Payment[]){
    const response=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.provider_reference!)}`,{headers:{Authorization:`Bearer ${secret}`}});
    const result=await response.json().catch(()=>({}));const transaction=result.data;checkedCount++;
    const providerStatus=String(transaction?.status??'unavailable').toLowerCase();const providerAmount=Number(transaction?.amount);const providerCurrency=String(transaction?.currency??'').toUpperCase();
    const statusMatches=(payment.status==='succeeded'&&providerStatus==='success')||(payment.status==='pending'&&['pending','ongoing','processing'].includes(providerStatus))||(payment.status==='failed'&&['failed','abandoned'].includes(providerStatus));
    const amountMatches=Number.isFinite(providerAmount)&&providerAmount===Number(payment.amount_kobo)&&providerCurrency===payment.currency;
    const matches=Boolean(response.ok&&result.status&&statusMatches&&amountMatches);let reconciled=false;
    let detail:string|null=null;
    if(!response.ok||!result.status)detail='Provider verification request failed';
    else if(!amountMatches)detail='Amount or currency differs from the recorded payment';
    else if(!statusMatches)detail=`Provider status ${providerStatus} differs from local status ${payment.status}`;
    if(payment.status==='pending'&&response.ok&&result.status&&amountMatches&&providerStatus==='success'){
      if(payment.payment_type==='wallet_topup'){
        const{data:topupResult,error}=await admin.rpc('wallet_complete_topup',{p_payment_id:payment.id,p_event_id:transaction.id?.toString()??payment.provider_reference});
        if(error||!topupResult)detail='Provider paid; wallet top up completion failed and needs review';else reconciled=true;
      }else{
        const{error}=await admin.from('payments').update({status:'succeeded',provider_event_id:transaction.id?.toString()??payment.provider_reference,updated_at:new Date().toISOString()}).eq('id',payment.id).eq('status','pending');
        if(error)detail='Provider paid; local payment status update failed';else reconciled=true;
      }
    }else if(payment.status==='pending'&&response.ok&&result.status&&['failed','abandoned'].includes(providerStatus)){
      if(payment.payment_type==='wallet_topup'){const{data:failed,error}=await admin.rpc('wallet_fail_topup',{p_payment_id:payment.id});reconciled=!error&&Boolean(failed);}
      else{const{error}=await admin.from('payments').update({status:'failed',updated_at:new Date().toISOString()}).eq('id',payment.id).eq('status','pending');reconciled=!error;}
    }
    if(!matches&&!reconciled)mismatchCount++;
    if(reconciled)detail=`Local payment status reconciled to provider-confirmed ${providerStatus}`;
    items.push({run_id:run.id,payment_id:payment.id,expected_status:payment.status,provider_status:providerStatus,expected_amount_kobo:payment.amount_kobo,provider_amount_kobo:Number.isFinite(providerAmount)?providerAmount:null,provider_currency:providerCurrency||null,matches:matches||reconciled,detail});
  }
  if(items.length){const{error}=await admin.from('payment_reconciliation_items').insert(items);if(error){await admin.from('payment_reconciliation_runs').update({status:'failed',error_summary:'Could not save reconciliation results.',checked_count:checkedCount,mismatch_count:mismatchCount,completed_at:new Date().toISOString()}).eq('id',run.id);return json({error:'Reconciliation ran but the results could not be saved.'},500,origin);}}
  await admin.from('payment_reconciliation_runs').update({status:mismatchCount?'partial':'completed',checked_count:checkedCount,mismatch_count:mismatchCount,completed_at:new Date().toISOString()}).eq('id',run.id);
  return json({ok:true,runId:run.id,checkedCount,mismatchCount},200,origin);
});
