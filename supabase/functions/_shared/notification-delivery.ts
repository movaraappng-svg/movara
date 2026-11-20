import { createClient } from 'npm:@supabase/supabase-js@2';

const origins = new Set(['http://localhost:5173','http://127.0.0.1:5173','https://movaraappng-svg.github.io']);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'null',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin',
});
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), {
  status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const templates: Record<string, [string,string]> = {
  ride_accepted: ['Your ride is confirmed','Your driver has accepted your ride.'],
  driver_arrived: ['Your driver has arrived','Your driver is at the pickup location.'],
  ride_started: ['Your ride has started','Your trip is now underway.'],
  ride_completed: ['You have arrived','Your ride has been completed.'],
  ride_cancelled: ['Ride cancelled','A ride in your account has been cancelled.'],
  enquiry_received: ['New property enquiry','Someone is interested in your property.'],
  property_enquiry: ['New property enquiry','Someone is interested in your property.'],
  viewing_scheduled: ['Viewing arranged','A property viewing has been arranged.'],
  viewing_approved: ['Viewing confirmed','Your property viewing has been confirmed.'],
  viewing_cancelled: ['Viewing cancelled','A property viewing has been cancelled.'],
  support_updated: ['Support update','There is an update to your support request.'],
  sos_raised: ['Safety alert received','MoVara has received your safety report.'],
  driver_approved: ['Driver account approved','Your driver identity review is complete.'],
  driver_rejected: ['Driver account needs attention','Review your account for the next steps.'],
  landlord_approved: ['Landlord account approved','Your landlord identity review is complete.'],
  landlord_rejected: ['Landlord account needs attention','Review your account for the next steps.'],
  wallet_transaction: ['Wallet update','There is an update to your wallet.'],
  refund_approved: ['Refund approved','Your refund request has been approved.'],
  corporate_approval: ['Ride approval update','There is an update to your corporate ride request.'],
  service_announcement: ['MoVara update','There is a service announcement from MoVara.'],
  maintenance_notice: ['Service notice','MoVara has a service update for you.'],
  safety_notice: ['Safety update','MoVara has shared an important safety notice.'],
};

function messageFor(notification: any) {
  const defaults = templates[notification.kind] ?? ['MoVara update','You have a new account update.'];
  const payload = notification.payload ?? {};
  const title = typeof payload.title === 'string' ? payload.title.slice(0,120) : defaults[0];
  let body = typeof payload.body === 'string' ? payload.body.slice(0,1000) : defaults[1];
  if (notification.kind.startsWith('ride_') && payload.pickup && payload.destination) {
    body = `${body} ${String(payload.pickup).slice(0,100)} to ${String(payload.destination).slice(0,100)}.`;
  }
  return { title, body };
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,'0')).join('');
}

async function logDelivery(admin: any, record: Record<string,unknown>) {
  const { error } = await admin.from('notification_delivery_logs').insert(record);
  return !error;
}

async function sendEmail(notification: any, user: any, admin: any) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  if (!apiKey || !from || !user.email) return { sent:false, provider:'resend', code:'email_not_configured' };
  const destinationHash = await hash(user.email.toLowerCase());
  if (!await logDelivery(admin,{ notification_id:notification.id,user_id:user.id,channel:'email',provider:'resend',destination_hash:destinationHash,status:'queued' })) return { sent:false,duplicate:true };
  const { title,body } = messageFor(notification);
  const result = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[user.email],subject:title,text:body})});
  const data = await result.json().catch(()=>({}));
  await admin.from('notification_delivery_logs').update({status:result.ok?'sent':'failed',provider_message_id:data.id??null,error_code:result.ok?null:`provider_http_${result.status}`}).eq('notification_id',notification.id).eq('channel','email').eq('provider','resend').eq('destination_hash',destinationHash);
  return { sent:result.ok,provider:'resend',code:result.ok?undefined:`provider_http_${result.status}` };
}

async function sendSms(notification: any, user: any, admin: any) {
  const rawPhone = user.phone?.trim();
  if (!rawPhone) return {sent:false,provider:'none',code:'phone_missing'};
  const digits=rawPhone.replace(/\D/g,'');
  const phone=rawPhone.startsWith('+')?`+${digits}`:digits.startsWith('0')?`+234${digits.slice(1)}`:digits.startsWith('234')?`+${digits}`:null;
  if(!phone||phone.length<10||phone.length>16)return {sent:false,provider:'none',code:'phone_invalid'};
  const termiiKey=Deno.env.get('TERMII_API_KEY');const termiiFrom=Deno.env.get('TERMII_SENDER_ID');
  const account=Deno.env.get('TWILIO_ACCOUNT_SID');const twilioToken=Deno.env.get('TWILIO_AUTH_TOKEN');
  const twilioFrom=Deno.env.get('TWILIO_FROM_NUMBER');const messagingService=Deno.env.get('TWILIO_MESSAGING_SERVICE_SID');
  const provider=termiiKey&&termiiFrom?'termii':account&&twilioToken&&(twilioFrom||messagingService)?'twilio':'none';
  if(provider==='none')return {sent:false,provider,code:'sms_not_configured'};
  const destinationHash=await hash(phone);
  if(!await logDelivery(admin,{notification_id:notification.id,user_id:user.id,channel:'sms',provider,destination_hash:destinationHash,status:'queued'}))return {sent:false,duplicate:true};
  const {title,body}=messageFor(notification);let response:Response;let data:any={};
  if(provider==='termii'){
    const base=(Deno.env.get('TERMII_BASE_URL')??'https://api.ng.termii.com/api').replace(/\/$/,'');
    const to=phone.replace(/^\+/,'');
    response=await fetch(`${base}/sms/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:termiiKey,to,from:termiiFrom,sms:`${title}: ${body}`,type:'plain',channel:Deno.env.get('TERMII_CHANNEL')??'dnd'})});
  }else{
    const form=new URLSearchParams({To:phone,Body:`${title}: ${body}`});
    if(messagingService)form.set('MessagingServiceSid',messagingService);else form.set('From',twilioFrom!);
    const auth=btoa(`${account}:${twilioToken}`);
    response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});
  }
  data=await response.json().catch(()=>({}));
  await admin.from('notification_delivery_logs').update({status:response.ok?'sent':'failed',provider_message_id:data.message_id??data.sid??null,error_code:response.ok?null:`provider_http_${response.status}`}).eq('notification_id',notification.id).eq('channel','sms').eq('provider',provider).eq('destination_hash',destinationHash);
  return {sent:response.ok,provider,code:response.ok?undefined:`provider_http_${response.status}`};
}

function base64url(bytes: Uint8Array) {
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function pemBytes(pem:string) {
  const raw=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const binary=atob(raw);return Uint8Array.from(binary,(char)=>char.charCodeAt(0));
}
async function fcmAccessToken(serviceAccount:any) {
  const now=Math.floor(Date.now()/1000);
  const header=base64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const claim=base64url(new TextEncoder().encode(JSON.stringify({iss:serviceAccount.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
  const unsigned=`${header}.${claim}`;
  const key=await crypto.subtle.importKey('pkcs8',pemBytes(serviceAccount.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned)));
  const assertion=`${unsigned}.${base64url(signature)}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const data=await response.json();if(!response.ok||!data.access_token)throw new Error('fcm_auth_failed');return data.access_token as string;
}

async function sendPush(notification:any,user:any,admin:any) {
  const {data:devices}=await admin.from('push_devices').select('id,provider,platform,token').eq('user_id',user.id).eq('enabled',true);
  if(!devices?.length)return {sent:false,provider:'none',code:'push_device_missing'};
  const {title,body}=messageFor(notification);let fcmToken:string|undefined;let serviceAccount:any;
  const serviceJson=Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if(serviceJson){try{serviceAccount=JSON.parse(serviceJson);fcmToken=await fcmAccessToken(serviceAccount);}catch{return {sent:false,provider:'fcm',code:'fcm_auth_failed'};}}
  let sent=0;const errors:string[]=[];
  for(const device of devices){
    const destinationHash=await hash(device.token);const provider=device.provider;
    if(!await logDelivery(admin,{notification_id:notification.id,user_id:user.id,channel:'push',provider,destination_hash:destinationHash,status:'queued'}))continue;
    let response:Response|undefined;let data:any={};
    if(provider==='expo'){
      const accessToken=Deno.env.get('EXPO_ACCESS_TOKEN');
      response=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json',...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},body:JSON.stringify({to:device.token,sound:'default',channelId:'updates',title,body,data:{notificationId:notification.id}})});
    }else if(provider==='fcm'&&fcmToken&&serviceAccount?.project_id){
      response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${fcmToken}`,'Content-Type':'application/json'},body:JSON.stringify({message:{token:device.token,notification:{title,body},data:{notificationId:notification.id}}})});
    }
    if(response)data=await response.json().catch(()=>({}));
    const ok=Boolean(response?.ok);
    const ticketId=device.provider==='expo'?data.data?.id:data.name;
    await admin.from('notification_delivery_logs').update({status:ok?'sent':'failed',provider_message_id:ticketId??null,error_code:ok?null:response?`provider_http_${response.status}`:`${provider}_not_configured`}).eq('notification_id',notification.id).eq('channel','push').eq('provider',provider).eq('destination_hash',destinationHash);
    if(ok)sent++;else errors.push(provider);
  }
  return {sent:sent>0,count:sent,failed:errors.length};
}

export function notificationDeliveryHandler(channel:'email'|'sms'|'push') {
  return async (request:Request) => {
    const origin=request.headers.get('origin');
    if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
    if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);
    if(origin&&!origins.has(origin))return json({error:'Origin not allowed'},403,origin);
    const authorization=request.headers.get('Authorization');
    const url=Deno.env.get('SUPABASE_URL');const anon=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!authorization?.startsWith('Bearer ')||!url||!anon||!service)return json({error:'Notification delivery is unavailable.'},503,origin);
    const caller=createClient(url,anon,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
    const {data:{user}}=await caller.auth.getUser();if(!user)return json({error:'Sign in to continue.'},401,origin);
    const body=await request.json().catch(()=>({}));const id=body?.notification_id;
    if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Notification id is invalid.'},400,origin);
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const [{data:notification},{data:profile},{data:preferences},{data:{user:authUser}}]=await Promise.all([
      admin.from('notifications').select('id,user_id,kind,payload,created_at').eq('id',id).eq('user_id',user.id).maybeSingle(),
      admin.from('profiles').select('phone').eq('id',user.id).maybeSingle(),
      admin.from('notification_preferences').select('kind,enabled').eq('user_id',user.id).eq('channel',channel),
      admin.auth.admin.getUserById(user.id),
    ]);
    if(!notification)return json({error:'Notification not found.'},404,origin);
    const exactPreference=preferences?.find((item:any)=>item.kind===notification.kind);
    const allPreference=preferences?.find((item:any)=>item.kind==='all');
    const channelEnabled=exactPreference?.enabled??allPreference?.enabled??(channel==='email');
    if(!channelEnabled)return json({skipped:true,reason:'preference_disabled'},200,origin);
    let result:any;
    const recipient={...(profile??{}),email:authUser?.email};
    if(channel==='email')result=await sendEmail(notification,recipient,admin);
    else if(channel==='sms')result=await sendSms(notification,recipient,admin);
    else result=await sendPush(notification,recipient,admin);
    if(result?.code==='email_not_configured'||result?.code==='sms_not_configured'||result?.code==='fcm_auth_failed')return json({error:'This notification channel is not configured on the server.'},503,origin);
    return json(result,200,origin);
  };
}
