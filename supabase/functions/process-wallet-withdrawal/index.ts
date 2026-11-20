import { createClient } from 'npm:@supabase/supabase-js@2';

const origins=new Set(['https://movaraappng-svg.github.io','http://localhost:5173','http://127.0.0.1:5173']);
const cors=(origin:string|null)=>({'Access-Control-Allow-Origin':origin&&origins.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS',Vary:'Origin'});
const json=(body:unknown,status:number,origin:string|null)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json'}});

Deno.serve(async request=>{
  const origin=request.headers.get('origin');
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);
  if(origin&&!origins.has(origin))return json({error:'Origin not allowed'},403,origin);
  const authorization=request.headers.get('Authorization');const url=Deno.env.get('SUPABASE_URL');const anon=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');const secret=Deno.env.get('PAYSTACK_SECRET_KEY');
  if(!authorization?.startsWith('Bearer '))return json({error:'Sign in to continue.'},401,origin);
  if(!url||!anon||!service||!secret)return json({error:'Paystack payouts are not configured.'},503,origin);
  const caller=createClient(url,anon,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
  const{data:{user}}=await caller.auth.getUser();if(!user)return json({error:'Your session has expired.'},401,origin);
  const{data:role}=await caller.from('user_roles').select('role').eq('user_id',user.id).eq('role','administrator').maybeSingle();
  if(!role)return json({error:'Administrator access required.'},403,origin);
  let body:{withdrawalId?:string};try{body=await request.json();}catch{return json({error:'Invalid request.'},400,origin);}
  if(!body.withdrawalId)return json({error:'Withdrawal request is required.'},400,origin);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  let{data:withdrawal,error}=await admin.from('wallet_withdrawals').select('id,user_id,amount_kobo,bank_code,account_number,account_name,status,provider,provider_reference').eq('id',body.withdrawalId).single();
  if(error||!withdrawal)return json({error:'Withdrawal was not found.'},404,origin);
  if(!['requested','processing'].includes(withdrawal.status))return json({error:`Withdrawal is already ${withdrawal.status}.`},409,origin);
  if(withdrawal.status==='processing'){
    if(withdrawal.provider!=='paystack'||!withdrawal.provider_reference)return json({error:'This is an older manual payout request. Review it manually; do not resubmit it through Paystack.'},409,origin);
    const verify=await fetch(`https://api.paystack.co/transfer/verify/${encodeURIComponent(withdrawal.provider_reference)}`,{headers:{Authorization:`Bearer ${secret}`}});
    const verification=await verify.json().catch(()=>({}));
    if(verify.ok&&verification.status){
      if(Number(verification.data?.amount)!==Number(withdrawal.amount_kobo)||verification.data?.currency!=='NGN')return json({error:'The verified transfer amount or currency does not match the held withdrawal. Contact support.'},409,origin);
      const providerStatus=String(verification.data?.status??'pending').toLowerCase();
      if(['success','failed','reversed'].includes(providerStatus)){
        const{data:finalized,error:finalizeError}=await admin.rpc('wallet_finalize_transfer',{p_provider_reference:withdrawal.provider_reference,p_provider_status:providerStatus,p_event_id:verification.data?.id?.toString()??withdrawal.provider_reference});
        if(finalizeError||!finalized)return json({error:'Provider status was found, but the wallet ledger could not be settled.'},500,origin);
        return json({ok:true,status:providerStatus==='success'?'paid':providerStatus,reference:withdrawal.provider_reference},200,origin);
      }
      return json({ok:true,status:providerStatus,reference:withdrawal.provider_reference,message:providerStatus==='otp'?'Paystack requires transfer OTP approval in the Paystack Dashboard.':'Transfer is still being processed.'},200,origin);
    }
    if(verify.status!==404)return json({error:'Could not verify the existing transfer. The request remains on hold; retry reconciliation later.'},502,origin);
  } else {
    const resolveUrl=new URL('https://api.paystack.co/bank/resolve');resolveUrl.searchParams.set('account_number',withdrawal.account_number);resolveUrl.searchParams.set('bank_code',withdrawal.bank_code);
    const resolvedResponse=await fetch(resolveUrl,{headers:{Authorization:`Bearer ${secret}`}});const resolved=await resolvedResponse.json().catch(()=>({}));
    if(!resolvedResponse.ok||!resolved.status||!resolved.data?.account_name)return json({error:String(resolved.message??'The bank account could not be verified. Check the bank code and account number.')},422,origin);
    const normalize=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(normalize(resolved.data.account_name)!==normalize(withdrawal.account_name))return json({error:`Bank verification name does not match the submitted name. Paystack resolved it as “${String(resolved.data.account_name).slice(0,120)}”. Reject this request and ask the user to submit the correct account details.`},422,origin);
    const recipientResponse=await fetch('https://api.paystack.co/transferrecipient',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({type:'nuban',name:resolved.data.account_name,account_number:withdrawal.account_number,bank_code:withdrawal.bank_code,currency:'NGN',description:`MoVara wallet payout ${withdrawal.id}`})});
    const recipient=await recipientResponse.json().catch(()=>({}));
    if(!recipientResponse.ok||!recipient.status||!recipient.data?.recipient_code)return json({error:String(recipient.message??'Could not verify payout recipient.')},502,origin);
    const reference=`movara_wd_${withdrawal.id.replaceAll('-','')}`;
    const{error:startError}=await caller.rpc('admin_update_wallet_withdrawal',{p_id:withdrawal.id,p_status:'processing',p_provider_reference:reference,p_note:`Bank verified as ${resolved.data.account_name}.`});
    if(startError)return json({error:startError.message??'Could not reserve the payout for processing.'},409,origin);
    withdrawal.provider='paystack';withdrawal.provider_reference=reference;
    const transferResponse=await fetch('https://api.paystack.co/transfer',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({source:'balance',amount:withdrawal.amount_kobo,recipient:recipient.data.recipient_code,reference,currency:'NGN',reason:`MoVara wallet withdrawal ${withdrawal.id}`})});
    const transfer=await transferResponse.json().catch(()=>({}));
    if(!transferResponse.ok||!transfer.status)return json({error:'Paystack did not confirm the payout request. Funds remain reserved. Retry to verify the reference before starting another transfer.'},502,origin);
    if(Number(transfer.data?.amount)!==Number(withdrawal.amount_kobo)||transfer.data?.currency!=='NGN'||transfer.data?.reference!==reference)return json({error:'Paystack response did not match the withdrawal amount, currency, and reference. Funds remain reserved.'},502,origin);
    const providerStatus=String(transfer.data?.status??'pending').toLowerCase();
    if(['success','failed','reversed'].includes(providerStatus)){
      const{error:finalizeError}=await admin.rpc('wallet_finalize_transfer',{p_provider_reference:reference,p_provider_status:providerStatus,p_event_id:transfer.data?.id?.toString()??reference});
      if(finalizeError)return json({error:'Paystack accepted the transfer, but local settlement failed. Reconcile the reference before retrying.'},500,origin);
    }
    return json({ok:true,status:providerStatus,reference,message:providerStatus==='otp'?'Paystack requires transfer OTP approval in the Paystack Dashboard.':'Paystack has accepted the transfer request.'},200,origin);
  }
  return json({error:'The transfer reference could not be found. Contact support before changing the held withdrawal.'},409,origin);
});
