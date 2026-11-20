import { createClient } from 'npm:@supabase/supabase-js@2';
import { validPoint, verifyQuote } from '../_shared/google-routes.ts';

const origins = new Set(['https://movaraappng-svg.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const cors = (origin: string | null) => ({ 'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'null', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' });
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (origin && !origins.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const signingSecret = Deno.env.get('RIDE_QUOTE_HMAC_SECRET');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to request a ride.' }, 401, origin);
  if (!url || !anon || !signingSecret || !serviceRole) return json({ error: 'Ride requests are not configured yet.' }, 503, origin);
  const userClient = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Your session has expired. Sign in again.' }, 401, origin);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400, origin); }
  if (typeof body.quoteToken !== 'string') return json({ error: 'Refresh your route and fare quote before requesting.' }, 400, origin);
  const quote = await verifyQuote(body.quoteToken, signingSecret);
  if (!quote || quote.sub !== user.id || Number(quote.exp) < Date.now()) return json({ error: 'This fare quote expired. Recalculate your route.' }, 409, origin);
  if (!validPoint(body.origin) || !validPoint(body.destination) || JSON.stringify(body.origin) !== JSON.stringify(quote.origin) || JSON.stringify(body.destination) !== JSON.stringify(quote.destination)) return json({ error: 'The route changed. Recalculate your fare quote.' }, 409, origin);
  if (body.serviceLevel !== quote.serviceLevel || Number(body.passengerCount) !== Number(quote.passengerCount)
    || body.cityCode !== quote.cityCode || Boolean(body.airportPickup) !== Boolean(quote.airportPickup)
    || (typeof body.promoCode === 'string' ? body.promoCode.toUpperCase() : '') !== String(quote.promoCode ?? '').toUpperCase()
    || (typeof body.corporateCode === 'string' ? body.corporateCode.toUpperCase() : '') !== String(quote.corporateCode ?? '').toUpperCase()) return json({ error: 'The ride selection or pricing code changed. Recalculate your fare quote.' }, 409, origin);
  const pickup = typeof body.pickupLabel === 'string' ? body.pickupLabel.trim() : '';
  const destination = typeof body.destinationLabel === 'string' ? body.destinationLabel.trim() : '';
  const note = typeof body.specialInstructions === 'string' ? body.specialInstructions.trim() : '';
  const paymentMethod = body.paymentMethod === 'wallet' ? 'wallet' : body.paymentMethod === 'paystack' ? 'paystack' : 'cash';
  if (!pickup || pickup.length > 300 || !destination || destination.length > 300 || note.length > 300) return json({ error: 'Add valid pickup and destination details.' }, 400, origin);
  const scheduledFor = typeof body.scheduledFor === 'string' ? new Date(body.scheduledFor) : null;
  if (scheduledFor && (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now() + 30 * 60_000)) return json({ error: 'Choose a pickup time at least 30 minutes from now.' }, 400, origin);
  if ((quote.scheduledFor ?? null) !== (scheduledFor?.toISOString() ?? null)) return json({ error: 'The pickup time changed. Refresh the quote.' }, 409, origin);
  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const { data: role } = await admin.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'customer').maybeSingle();
  if (!role) return json({ error: 'A customer account is required to request a ride.' }, 403, origin);
  let ride:any;let error:any;
  if(paymentMethod==='wallet'){
    const result=await admin.rpc('wallet_create_paid_ride',{
      p_user_id:user.id,p_pickup_label:pickup,p_destination_label:destination,
      p_pickup_latitude:body.origin.latitude,p_pickup_longitude:body.origin.longitude,
      p_destination_latitude:body.destination.latitude,p_destination_longitude:body.destination.longitude,
      p_service_level:quote.serviceLevel,p_passenger_count:quote.passengerCount,p_fare_kobo:quote.fareKobo,
      p_city_code:quote.cityCode,p_scheduled_for:scheduledFor?.toISOString()??null,p_special_instructions:note||null,
      p_surge_multiplier:quote.surgeMultiplier,p_airport_surcharge_kobo:quote.airportSurchargeNgnKobo,
      p_promotion_discount_kobo:quote.promotionDiscountNgnKobo,p_promo_code:quote.promoCode??null,
      p_corporate_code:quote.corporateCode??null,
    });
    error=result.error;ride=Array.isArray(result.data)?result.data[0]:result.data;
  }else{
    const result=await admin.from('rides').insert({
    customer_id: user.id, pickup_label: pickup, destination_label: destination,
    pickup_latitude: body.origin.latitude, pickup_longitude: body.origin.longitude,
    destination_latitude: body.destination.latitude, destination_longitude: body.destination.longitude,
    service_level: quote.serviceLevel, passenger_count: quote.passengerCount,
    estimated_fare_ngn_kobo: quote.fareKobo, currency: quote.currency ?? 'NGN', scheduled_for: scheduledFor?.toISOString() ?? null,
    special_instructions: note || null, payment_method: paymentMethod, status: 'requested',
    city_code: quote.cityCode, surge_multiplier: quote.surgeMultiplier,
    airport_surcharge_ngn_kobo: quote.airportSurchargeNgnKobo,
    promotion_discount_ngn_kobo: quote.promotionDiscountNgnKobo,
    promo_code: quote.promoCode, corporate_code: quote.corporateCode,
    }).select('id,status,estimated_fare_ngn_kobo,created_at').single();
    ride=result.data;error=result.error;
  }
  if (error) { console.error('Ride insert failed', error);const lowBalance=String(error.message??'').includes('Wallet balance is too low');return json({ error:lowBalance?'Your wallet balance is too low for this ride. Add money or choose another payment method.':'Your ride could not be saved. Please try again.' }, lowBalance?409:500, origin); }
  return json({ ride }, 201, origin);
});
