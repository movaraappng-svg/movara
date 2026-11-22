import { createClient } from 'npm:@supabase/supabase-js@2';
import { calculateGoogleRoute, signQuote, validPoint } from '../_shared/google-routes.ts';
import { calculateOpenRouteServiceRoute } from '../_shared/openrouteservice.ts';
import { calculateFare } from '../_shared/fare-engine.mjs';

const origins = new Set(['https://movaraappng-svg.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const cors = (origin: string | null) => ({ 'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'null', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' });
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

function insideBoundary(point: { latitude: number; longitude: number }, boundary: unknown) {
  const geometry = (boundary as any)?.type === 'Feature' ? (boundary as any).geometry : boundary;
  const coordinates = geometry?.coordinates?.[0];
  if (geometry?.type !== 'Polygon' || !Array.isArray(coordinates) || coordinates.length < 4) return false;
  const x = point.longitude; const y = point.latitude; let inside = false;
  for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
    const xi = Number(coordinates[i][0]); const yi = Number(coordinates[i][1]);
    const xj = Number(coordinates[j][0]); const yj = Number(coordinates[j][1]);
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (origin && !origins.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
  const authorization = request.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const mapsKey = Deno.env.get('GOOGLE_MAPS_ROUTES_API_KEY');
  const openRouteServiceKey = Deno.env.get('ORS_API_KEY');
  const signingSecret = Deno.env.get('RIDE_QUOTE_HMAC_SECRET');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to calculate a route.' }, 401, origin);
  if (!url || !anon || (!mapsKey && !openRouteServiceKey) || !signingSecret) return json({ error: 'Live route quotes are not configured yet.' }, 503, origin);

  const userClient = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Your session has expired. Sign in again.' }, 401, origin);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400, origin); }
  if (!validPoint(body.origin) || !validPoint(body.destination)) return json({ error: 'Choose valid pickup and destination points.' }, 400, origin);
  const serviceLevel = body.serviceLevel;
  const passengerCount = Number(body.passengerCount ?? 1);
  if (!['economy', 'comfort', 'xl', 'executive'].includes(String(serviceLevel)) || !Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 20) {
    return json({ error: 'Choose a valid vehicle and passenger count.' }, 400, origin);
  }
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const route = openRouteServiceKey
      ? await calculateOpenRouteServiceRoute(body.origin, body.destination, openRouteServiceKey)
      : await calculateGoogleRoute(body.origin, body.destination, mapsKey!, typeof body.scheduledFor === 'string' ? body.scheduledFor : null);
    let cityCode = typeof body.cityCode === 'string' && /^[A-Z0-9-]{2,24}$/.test(body.cityCode) ? body.cityCode : 'NG-DEFAULT';
    let { data: city } = await admin.from('ride_cities').select('city_code,active,currency').eq('city_code', cityCode).maybeSingle();
    if (!city?.active) {
      cityCode = 'NG-DEFAULT';
      const fallbackCity = await admin.from('ride_cities').select('city_code,active,currency').eq('city_code', cityCode).maybeSingle();
      city = fallbackCity.data;
    }
    const { data: rule, error } = await admin.from('ride_pricing_rules').select('base_fare_ngn_kobo,booking_fee_ngn_kobo,per_kilometer_ngn_kobo,per_minute_ngn_kobo,minimum_fare_ngn_kobo,cancellation_fee_ngn_kobo,commission_basis_points').eq('city_code', cityCode).eq('service_level', serviceLevel).eq('active', true).maybeSingle();
    if (error || !rule) return json({ ...route, fareReady: false, error: 'A fare rate is not configured for this ride class yet.' }, 200, origin);
    const { data: surge } = await admin.from('ride_surge_settings').select('enabled,automatic_demand,min_multiplier,max_multiplier,demand_per_driver_threshold,trigger_multipliers').eq('city_code', cityCode).maybeSingle();
    let surgeMultiplier = 1;
    if (surge?.enabled) {
      const triggerValues = Object.values(surge.trigger_multipliers ?? {}).map(Number).filter((value) => Number.isFinite(value) && value >= 1);
      surgeMultiplier = Math.max(surge.min_multiplier, ...triggerValues);
      if (surge.automatic_demand) {
        const [demand, drivers] = await Promise.all([
          admin.from('rides').select('id', { count: 'exact', head: true }).eq('city_code', cityCode).in('status', ['requested', 'matching']),
          admin.from('driver_profiles').select('driver_id', { count: 'exact', head: true }).eq('city_code', cityCode).eq('is_online', true),
        ]);
        const ratio = (demand.count ?? 0) / Math.max(1, drivers.count ?? 0);
        const autoMultiplier = Math.min(Number(surge.max_multiplier), Math.max(Number(surge.min_multiplier), ratio / Number(surge.demand_per_driver_threshold)));
        surgeMultiplier = Math.max(surgeMultiplier, autoMultiplier);
      }
      surgeMultiplier = Math.min(Number(surge.max_multiplier), surgeMultiplier);
    }
    const { data: adjustments = [] } = await admin.from('ride_pricing_adjustments').select('id,city_code,adjustment_type,name,code,boundary,amount_ngn_kobo,multiplier,discount_basis_points,starts_at,ends_at,active')
      .in('city_code', cityCode === 'NG-DEFAULT' ? [cityCode] : [cityCode, 'NG-DEFAULT']).eq('active', true);
    const now = Date.now();
    const current = adjustments.filter((adjustment) => (!adjustment.starts_at || new Date(adjustment.starts_at).getTime() <= now)
      && (!adjustment.ends_at || new Date(adjustment.ends_at).getTime() > now));
    const airportAdjustment = Boolean(body.airportPickup) ? current.filter((item) => item.adjustment_type === 'airport') : [];
    const zoneAdjustments = current.filter((item) => item.adjustment_type === 'zone' && insideBoundary(body.origin as any, item.boundary));
    const events = current.filter((item) => item.adjustment_type === 'event');
    const promo = typeof body.promoCode === 'string' ? current.find((item) => item.adjustment_type === 'promo' && item.code?.toLowerCase() === body.promoCode.toLowerCase()) : null;
    const corporate = typeof body.corporateCode === 'string' ? current.find((item) => item.adjustment_type === 'corporate' && item.code?.toLowerCase() === body.corporateCode.toLowerCase()) : null;
    const airportSurcharge = airportAdjustment.reduce((sum, item) => sum + Number(item.amount_ngn_kobo), 0);
    const zoneSurcharge = zoneAdjustments.reduce((sum, item) => sum + Number(item.amount_ngn_kobo), 0);
    const zoneMultiplier = Math.max(1, ...zoneAdjustments.map((item) => Number(item.multiplier)));
    const eventMultiplier = Math.max(1, ...events.map((item) => Number(item.multiplier)));
    const quote = calculateFare({
      bookingFeeKobo: Number(rule.booking_fee_ngn_kobo ?? rule.base_fare_ngn_kobo),
      distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds,
      perKilometerKobo: Number(rule.per_kilometer_ngn_kobo), perMinuteKobo: Number(rule.per_minute_ngn_kobo),
      minimumFareKobo: Number(rule.minimum_fare_ngn_kobo), airportSurchargeKobo: airportSurcharge,
      zoneSurchargeKobo: zoneSurcharge, surgeMultiplier, zoneMultiplier, eventMultiplier,
      promoAmountKobo: Number(promo?.amount_ngn_kobo ?? 0), promoBasisPoints: Number(promo?.discount_basis_points ?? 0),
      corporateAmountKobo: Number(corporate?.amount_ngn_kobo ?? 0), corporateBasisPoints: Number(corporate?.discount_basis_points ?? 0),
    });
    const fare = quote.totalKobo;
    const components = {
      bookingFeeNgnKobo: quote.bookingFeeKobo, distanceFareNgnKobo: quote.distanceFareKobo,
      timeFareNgnKobo: quote.timeFareKobo, airportSurchargeNgnKobo: quote.airportSurchargeKobo,
      zoneSurchargeNgnKobo: quote.zoneSurchargeKobo, surgeMultiplier: quote.surgeMultiplier,
      zoneMultiplier: quote.zoneMultiplier, eventMultiplier: quote.eventMultiplier,
      promotionDiscountNgnKobo: quote.discountKobo,
      cancellationFeeNgnKobo: Number(rule.cancellation_fee_ngn_kobo), commissionBasisPoints: Number(rule.commission_basis_points),
    };
    const quoteToken = await signQuote({
      sub: user.id, serviceLevel, passengerCount, fareKobo: fare, cityCode, currency: city?.currency ?? 'NGN',
      airportPickup: Boolean(body.airportPickup), promoCode: promo?.code ?? null, corporateCode: corporate?.code ?? null,
      ...components,
      origin: body.origin, destination: body.destination,
      scheduledFor: typeof body.scheduledFor === 'string' ? body.scheduledFor : null,
      distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds,
      iat: now, exp: now + 120_000,
    }, signingSecret);
    return json({ ...route, fareReady: true, estimatedFareNgnKobo: fare, provisionalFare: false, currency: city?.currency ?? 'NGN', serviceLevel, cityCode, components, quoteToken }, 200, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Live route is temporarily unavailable.' }, 502, origin);
  }
});
