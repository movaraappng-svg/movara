import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { AppText as Text } from '../src/AppText';
import * as Location from 'expo-location';
import { Camera, GeoJSONSource, Layer, Map as MapLibre } from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { supabase, isConfigured } from '../src/supabase';

const navy = '#172F4E';
const cream = '#F6F3ED';
const rideOptions = [
  { key: 'economy', title: 'MoVara Economy', people: 4 },
  { key: 'comfort', title: 'MoVara Comfort', people: 4 },
  { key: 'xl', title: 'MoVara XL', people: 6 },
  { key: 'executive', title: 'MoVara Executive', people: 4 },
];

function decodePolyline(encoded = '') {
  let index = 0; let latitude = 0; let longitude = 0; const points = [];
  while (index < encoded.length) {
    let result = 0; let shift = 0; let byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
    latitude += (result & 1) ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
    longitude += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}

function money(kobo) { return `₦${Math.round(Number(kobo ?? 0) / 100).toLocaleString()}`; }

export default function RidesScreen() {
  const camera = useRef(null);
  const [user, setUser] = useState(null); const [authLoading, setAuthLoading] = useState(true);
  const [pickup, setPickup] = useState(''); const [destination, setDestination] = useState('');
  const [pickupPoint, setPickupPoint] = useState(null); const [destinationPoint, setDestinationPoint] = useState(null);
  const [mapTarget, setMapTarget] = useState('pickup'); const [mapRegion, setMapRegion] = useState({ latitude: 9.082, longitude: 8.6753, latitudeDelta: 12, longitudeDelta: 12 });
  const [service, setService] = useState('economy'); const [passengers, setPassengers] = useState(1); const [airportPickup, setAirportPickup] = useState(false);
  const [promoCode, setPromoCode] = useState(''); const [paymentMethod, setPaymentMethod] = useState('cash');
  const [quote, setQuote] = useState(null); const [quoteLoading, setQuoteLoading] = useState(false); const [quoteError, setQuoteError] = useState('');
  const [locating, setLocating] = useState(false); const [busy, setBusy] = useState(false); const [rides, setRides] = useState([]); const [rideLoading, setRideLoading] = useState(false); const [checkout, setCheckout] = useState(null);
  const routeCoordinates = useMemo(() => decodePolyline(quote?.encodedPolyline), [quote?.encodedPolyline]);
  const mapFeatures = useMemo(() => ({
    type: 'FeatureCollection',
    features: [
      ...(pickupPoint ? [{ type: 'Feature', properties: { kind: 'pickup' }, geometry: { type: 'Point', coordinates: [pickupPoint.longitude, pickupPoint.latitude] } }] : []),
      ...(destinationPoint ? [{ type: 'Feature', properties: { kind: 'destination' }, geometry: { type: 'Point', coordinates: [destinationPoint.longitude, destinationPoint.latitude] } }] : []),
      ...(routeCoordinates.length > 1 ? [{ type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: routeCoordinates.map(({ latitude, longitude }) => [longitude, latitude]) } }] : []),
    ],
  }), [pickupPoint, destinationPoint, routeCoordinates]);

  async function loadRides(silent = false) {
    if (!isConfigured || !user) return;
    if (!silent) setRideLoading(true);
    const { data, error } = await supabase.from('rides').select('id,pickup_label,destination_label,status,driver_arrived_at,cancellation_reason,estimated_fare_ngn_kobo,currency,payment_method,service_level,passenger_count,scheduled_for,created_at,cancellation_fee_ngn_kobo').eq('customer_id', user.id).order('created_at', { ascending: false }).limit(12);
    if (error) Alert.alert('Ride history unavailable', 'Please check your connection and try again.'); else setRides(data ?? []);
    setRideLoading(false);
  }

  useEffect(() => { let alive = true; supabase?.auth.getUser().then(({ data }) => { if (alive) { setUser(data.user ?? null); setAuthLoading(false); } }); return () => { alive = false; }; }, []);
  useEffect(() => { if (!user) return; loadRides(); const channel = supabase.channel(`mobile-rides-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `customer_id=eq.${user.id}` }, () => loadRides(true)).subscribe(); return () => { supabase.removeChannel(channel); }; }, [user?.id]);

  useEffect(() => {
    if (!user || !pickupPoint || !destinationPoint || !isConfigured) { setQuote(null); setQuoteError(''); return undefined; }
    let alive = true; const timer = setTimeout(async () => {
      setQuoteLoading(true); setQuoteError('');
      const { data, error } = await supabase.functions.invoke('route-estimate', { body: { origin: pickupPoint, destination: destinationPoint, serviceLevel: service, passengerCount: passengers, cityCode: 'NG-DEFAULT', airportPickup, promoCode: promoCode.trim() } });
      if (!alive) return;
      if (error || !data?.fareReady || !data?.encodedPolyline) { setQuote(null); setQuoteError(data?.error || error?.message || 'A live route is unavailable for these points.'); }
      else setQuote(data);
      setQuoteLoading(false);
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [user?.id, pickupPoint, destinationPoint, service, passengers, airportPickup, promoCode]);

  async function reverseLabel(point) {
    try { const result = await Location.reverseGeocodeAsync(point); const place = result[0]; return place ? [place.name, place.street, place.district, place.city, place.region].filter(Boolean).join(', ') : `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`; }
    catch { return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`; }
  }

  async function setSelectedPoint(point) {
    const label = await reverseLabel(point);
    if (mapTarget === 'pickup') { setPickupPoint(point); setPickup(label); }
    else { setDestinationPoint(point); setDestination(label); }
    setMapRegion((current) => ({ ...point, latitudeDelta: Math.min(current.latitudeDelta, .06), longitudeDelta: Math.min(current.longitudeDelta, .06) }));
    camera.current?.flyTo({ center: [point.longitude, point.latitude], zoom: 14, duration: 450 });
  }

  async function currentLocation() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { Alert.alert('Location permission needed', 'Allow location access to use your current position as pickup.'); return; }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const point = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      setMapTarget('pickup'); await setSelectedPoint(point);
    } catch { Alert.alert('Could not find your location', 'Try again or place your pickup pin on the map.'); }
    finally { setLocating(false); }
  }

  async function requestRide() {
    if (!pickup.trim() || !destination.trim()) return Alert.alert('Add your route', 'Enter pickup and destination details.');
    if (!pickupPoint || !destinationPoint) return Alert.alert('Choose both map points', 'Use the map to place a pickup and destination pin.');
    if (pickupPoint.latitude === destinationPoint.latitude && pickupPoint.longitude === destinationPoint.longitude) return Alert.alert('Choose a different destination', 'Pickup and destination cannot be the same point.');
    if (!user) return Alert.alert('Sign in to continue', 'Sign in to save and follow your ride.', [{ text: 'Not now', style: 'cancel' }, { text: 'Sign in', onPress: () => router.push('/auth') }]);
    if (!quote?.quoteToken) return Alert.alert('Live fare needed', quoteError || 'Wait for a live route and fare before requesting a driver.');
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('request-ride', { body: { quoteToken: quote.quoteToken, pickupLabel: pickup.trim(), destinationLabel: destination.trim(), origin: pickupPoint, destination: destinationPoint, serviceLevel: service, passengerCount: passengers, cityCode: quote.cityCode, scheduledFor: null, specialInstructions: '', paymentMethod, airportPickup, promoCode: promoCode.trim(), corporateCode: '' } });
    setBusy(false);
    if (error || data?.error) return Alert.alert('Ride request not sent', data?.error || error?.message || 'Please try again.');
    Alert.alert('Ride request saved', 'We’ll update your ride status here when it changes.');
    setPickup(''); setDestination(''); setPickupPoint(null); setDestinationPoint(null); setPromoCode(''); setAirportPickup(false); setQuote(null);
    await loadRides();
  }

  async function cancelRide(ride) {
    Alert.alert('Cancel this ride?', 'Any applicable cancellation fee will be shown before you confirm.', [{ text: 'Keep ride', style: 'cancel' }, { text: 'Cancel ride', style: 'destructive', onPress: async () => {
      const { error } = await supabase.rpc('cancel_ride', { p_ride_id: ride.id, p_reason: 'Cancelled by rider' });
      if (error) Alert.alert('Could not cancel ride', error.message); else await loadRides();
    } }]);
  }

  async function payForRide(ride) {
    setCheckout(ride.id);
    try {
      const { data, error } = await supabase.functions.invoke('initialize-paystack-payment', { body: { rideId: ride.id, paymentType: 'ride' } });
      if (error || data?.error) throw error ?? new Error(data?.error || 'Please try again.');
      if (data?.paid) {
        Alert.alert('Already paid', 'This ride payment is confirmed.');
        await loadRides();
        return;
      }
      if (!data?.authorizationUrl || !data?.reference) throw new Error('Secure checkout could not be opened. Please try again.');
      await WebBrowser.openBrowserAsync(data.authorizationUrl);
      const { data: verification, error: verificationError } = await supabase.functions.invoke('verify-paystack-payment', { body: { reference: data.reference } });
      if (verificationError) throw verificationError;
      if (verification?.paid) Alert.alert('Payment confirmed', 'Your ride payment has been verified securely.');
      else Alert.alert('Payment not confirmed yet', verification?.error || 'If you completed payment, allow a moment for confirmation, then refresh your ride.');
      await loadRides();
    } catch (error) {
      Alert.alert('Checkout unavailable', error?.message || 'Please try again.');
    } finally {
      setCheckout(null);
    }
  }

  if (authLoading) return <View style={styles.loading}><ActivityIndicator color={navy}/></View>;
  const region = mapRegion;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled"><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><Text style={styles.kicker}>YOUR NEXT JOURNEY</Text><Text style={styles.title}>Book a ride</Text><Text style={styles.copy}>A live road route and fare before you send your request.</Text>
    <View style={styles.mapFrame}><MapLibre style={styles.map} mapStyle="https://tiles.openfreemap.org/styles/liberty" attribution onPress={(event) => { const [longitude, latitude] = event.nativeEvent.lngLat; setSelectedPoint({ latitude, longitude }); }}><Camera ref={camera} initialViewState={{ center: [region.longitude, region.latitude], zoom: 5 }}/><GeoJSONSource id="movara-ride-features" data={mapFeatures}><Layer id="movara-ride-route" type="line" filter={["==", ["get", "kind"], "route"]} paint={{ "line-color": "#B99B62", "line-width": 5, "line-opacity": 0.94 }}/><Layer id="movara-ride-pins" type="circle" filter={["in", ["get", "kind"], ["literal", ["pickup", "destination"]]]} paint={{ "circle-radius": 8, "circle-color": ["match", ["get", "kind"], "destination", "#B35C54", "#172F4E"], "circle-stroke-width": 3, "circle-stroke-color": "#FFFFFF" }}/></GeoJSONSource></MapLibre></View>
    <Text style={styles.mapHint}>Map data © OpenStreetMap contributors · OpenFreeMap. Tap the map after choosing which pin to place.</Text>
    {routeCoordinates.length > 0 && <Text style={styles.mapHint}>Road routing © openrouteservice.org by HeiGIT.</Text>}
    <View style={styles.mapActions}><Pressable onPress={() => setMapTarget('pickup')} style={[styles.pinButton, mapTarget === 'pickup' && styles.pinSelected]}><Text style={styles.pinText}>Set pickup pin</Text></Pressable><Pressable onPress={() => setMapTarget('destination')} style={[styles.pinButton, mapTarget === 'destination' && styles.pinSelected]}><Text style={styles.pinText}>Set destination pin</Text></Pressable></View>
    <Pressable style={styles.location} onPress={currentLocation} disabled={locating}><Text style={styles.locationText}>{locating ? 'Finding your location…' : '◎  Use my current location for pickup'}</Text></Pressable>
    <TextInput style={styles.input} value={pickup} onChangeText={(value) => { setPickup(value); setPickupPoint(null); }} placeholder="Pickup location" placeholderTextColor="#8A9095" accessibilityLabel="Pickup location"/><TextInput style={styles.input} value={destination} onChangeText={(value) => { setDestination(value); setDestinationPoint(null); }} placeholder="Destination" placeholderTextColor="#8A9095" accessibilityLabel="Destination"/>
    <Text style={styles.heading}>Choose your ride</Text>
    {rideOptions.map((item) => <Pressable key={item.key} onPress={() => setService(item.key)} style={[styles.choice, service === item.key && styles.selected]}><View><Text style={styles.choiceTitle}>{item.title}</Text><Text style={styles.subtle}>{item.people} passengers</Text></View><Text style={styles.choicePrice}>{quote?.serviceLevel === item.key ? money(quote.estimatedFareNgnKobo) : 'Live quote'}</Text></Pressable>)}
    <View style={styles.stepRow}><Text style={styles.heading}>Passengers</Text><View style={styles.stepper}><Pressable onPress={() => setPassengers((count) => Math.max(1, count - 1))} style={styles.stepButton}><Text style={styles.stepText}>−</Text></Pressable><Text style={styles.passengerCount}>{passengers}</Text><Pressable onPress={() => setPassengers((count) => Math.min(rideOptions.find((item) => item.key === service)?.people ?? 4, count + 1))} style={styles.stepButton}><Text style={styles.stepText}>+</Text></Pressable></View></View>
    <View style={styles.switchRow}><View><Text style={styles.choiceTitle}>Airport pickup</Text><Text style={styles.subtle}>Include an active airport surcharge if configured.</Text></View><Switch value={airportPickup} onValueChange={setAirportPickup} trackColor={{ true: '#B99B62' }}/></View>
    <TextInput style={styles.input} value={promoCode} onChangeText={(value) => setPromoCode(value.toUpperCase())} autoCapitalize="characters" placeholder="Promo code (optional)" placeholderTextColor="#8A9095"/>
    <View style={styles.paymentRow}><Pressable onPress={() => setPaymentMethod('cash')} style={[styles.paymentOption, paymentMethod === 'cash' && styles.pinSelected]}><Text style={styles.pinText}>Cash</Text></Pressable><Pressable onPress={() => setPaymentMethod('paystack')} style={[styles.paymentOption, paymentMethod === 'paystack' && styles.pinSelected]}><Text style={styles.pinText}>Pay online</Text></Pressable><Pressable onPress={() => setPaymentMethod('wallet')} style={[styles.paymentOption, paymentMethod === 'wallet' && styles.pinSelected]}><Text style={styles.pinText}>Wallet</Text></Pressable></View>
    <View style={styles.fareBox}>{quoteLoading ? <View style={styles.inline}><ActivityIndicator color={navy}/><Text style={styles.subtle}>Calculating road route and fare…</Text></View> : quote ? <><Text style={styles.fareTitle}>Estimated fare</Text><Text style={styles.fare}>{money(quote.estimatedFareNgnKobo)}</Text><Text style={styles.subtle}>{(quote.distanceMeters / 1000).toFixed(1)} km by road · {Math.ceil(quote.durationSeconds / 60)} min · final amount may change if the trip changes</Text></> : <Text style={styles.subtle}>{quoteError || 'Choose both points on the map to get a live fare.'}</Text>}</View>
    {!user && <Pressable style={styles.signin} onPress={() => router.push('/auth')}><Text style={styles.signinText}>Sign in to request this ride</Text></Pressable>}
    <Pressable style={[styles.button, (busy || !quote || !user) && styles.disabled]} onPress={requestRide} disabled={busy || !quote || !user}><Text style={styles.buttonText}>{busy ? 'Sending request…' : quote ? `Request ride · ${money(quote.estimatedFareNgnKobo)}` : 'Get live fare to continue'}</Text></Pressable>
    <View style={styles.historyHeader}><Text style={styles.heading}>Recent rides</Text><Pressable onPress={() => loadRides()}><Text style={styles.refresh}>Refresh</Text></Pressable></View>
    {rideLoading && <ActivityIndicator color={navy}/ >}
    {rides.map((ride) => <View key={ride.id} style={styles.rideCard}><View style={styles.rideTop}><Text style={styles.status}>{ride.status.replaceAll('_',' ')}</Text><Text style={styles.rideFare}>{money(ride.estimated_fare_ngn_kobo)}</Text></View><Text style={styles.rideRoute}>{ride.pickup_label}</Text><Text style={styles.rideRoute}>↓  {ride.destination_label}</Text><Text style={styles.subtle}>{ride.service_level} · {ride.passenger_count} {ride.passenger_count === 1 ? 'passenger' : 'passengers'} · {new Date(ride.created_at).toLocaleString()}</Text>{ride.driver_arrived_at && <Text style={styles.subtle}>Your driver marked arrival at {new Date(ride.driver_arrived_at).toLocaleTimeString()}.</Text>}{ride.cancellation_reason === 'rider_no_show' && <Text style={styles.subtle}>Driver reported a no-show after waiting at pickup. No no-show fee was added. If you prepaid online, contact support to review the payment.</Text>}{ride.status === 'accepted' && ride.payment_method === 'paystack' && <Pressable style={styles.inlineAction} onPress={() => payForRide(ride)} disabled={checkout === ride.id}><Text style={styles.refresh}>{checkout === ride.id ? 'Opening checkout…' : 'Pay securely'}</Text></Pressable>}{['requested','matching','accepted'].includes(ride.status) && <Pressable style={styles.cancel} onPress={() => cancelRide(ride)}><Text style={styles.cancelText}>Cancel ride</Text></Pressable>}</View>)}
    {!rideLoading && user && rides.length === 0 && <View style={styles.empty}><Text style={styles.emptyTitle}>No rides yet</Text><Text style={styles.subtle}>Your ride requests and updates will appear here.</Text></View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: cream, padding: 22, paddingTop: 56, paddingBottom: 48 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: cream }, back: { color: navy, fontSize: 16, fontWeight: '600', marginBottom: 26 }, kicker: { color: '#A48652', letterSpacing: 1.5, fontWeight: '700', fontSize: 11 }, title: { color: navy, fontSize: 36, fontWeight: '700', marginTop: 7 }, copy: { color: '#727A82', fontSize: 15, marginTop: 6, marginBottom: 20, lineHeight: 22 }, mapFrame: { height: 250, borderRadius: 20, overflow: 'hidden' }, map: { flex: 1 }, mapHint: { color: '#777F87', fontSize: 12, marginTop: 7 }, mapActions: { flexDirection: 'row', gap: 8, marginTop: 11 }, pinButton: { flex: 1, padding: 11, alignItems: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#E2DDD5', backgroundColor: 'white' }, pinSelected: { borderColor: navy, backgroundColor: '#E8EDF3' }, pinText: { color: navy, fontWeight: '600', fontSize: 13 }, location: { alignSelf: 'flex-start', paddingVertical: 13 }, locationText: { color: navy, fontWeight: '600' }, input: { backgroundColor: 'white', minHeight: 56, borderRadius: 13, paddingHorizontal: 15, marginTop: 10, borderWidth: 1, borderColor: '#E5E0D8', color: navy, fontSize: 15 }, heading: { color: navy, fontSize: 20, fontWeight: '700', marginTop: 24, marginBottom: 10 }, choice: { backgroundColor: 'white', padding: 15, borderRadius: 14, borderColor: '#E5E0D8', borderWidth: 1, marginBottom: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, selected: { borderColor: navy, borderWidth: 1.5 }, choiceTitle: { color: navy, fontWeight: '600', fontSize: 15 }, choicePrice: { color: navy, fontWeight: '700' }, subtle: { color: '#777F87', fontSize: 12, lineHeight: 18, marginTop: 3 }, stepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 }, stepButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', borderColor: '#E5E0D8', borderWidth: 1 }, stepText: { color: navy, fontSize: 20 }, passengerCount: { color: navy, fontWeight: '700', fontSize: 16 }, switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginTop: 12 }, paymentRow: { flexDirection: 'row', gap: 9, marginTop: 12 }, paymentOption: { flex: 1, padding: 13, alignItems: 'center', borderRadius: 12, backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E0D8' }, fareBox: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E0D8', borderRadius: 15, padding: 16, marginTop: 16 }, fareTitle: { color: navy, fontWeight: '600' }, fare: { color: navy, fontWeight: '700', fontSize: 28, marginVertical: 5 }, inline: { flexDirection: 'row', gap: 10, alignItems: 'center' }, button: { backgroundColor: navy, borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 14 }, disabled: { opacity: .5 }, buttonText: { color: 'white', fontSize: 15, fontWeight: '700' }, signin: { padding: 14, marginTop: 12, alignItems: 'center' }, signinText: { color: navy, fontWeight: '700' }, historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }, refresh: { color: navy, fontWeight: '600' }, rideCard: { backgroundColor: 'white', borderRadius: 15, padding: 15, marginTop: 10, borderColor: '#E5E0D8', borderWidth: 1 }, rideTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }, status: { color: '#536F57', textTransform: 'capitalize', fontWeight: '600' }, rideFare: { color: navy, fontWeight: '700' }, rideRoute: { color: navy, fontWeight: '500', marginBottom: 4 }, inlineAction: { alignSelf: 'flex-start', paddingTop: 12 }, cancel: { alignSelf: 'flex-start', marginTop: 12 }, cancelText: { color: '#A64748', fontWeight: '600' }, empty: { marginTop: 15, backgroundColor: 'white', borderRadius: 15, padding: 18 }, emptyTitle: { color: navy, fontWeight: '700', fontSize: 18 },
});
