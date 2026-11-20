import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { AppText as Text } from '../src/AppText';
import { router } from 'expo-router';
import { isConfigured, supabase } from '../src/supabase';

const navy = '#172F4E';
const money = (kobo = 0) => `₦${Math.round(Number(kobo) / 100).toLocaleString('en-NG')}`;
const newId = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

export default function DriverScreen() {
  const [clockNow, setClockNow] = useState(Date.now());
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [role, setRole] = useState(false); const [requestStatus, setRequestStatus] = useState(''); const [identity, setIdentity] = useState('not_submitted');
  const [vehicles, setVehicles] = useState([]); const [rides, setRides] = useState([]); const [online, setOnline] = useState(false); const [city, setCity] = useState('NG-DEFAULT');
  const [vehicleType, setVehicleType] = useState('car'); const [make, setMake] = useState(''); const [model, setModel] = useState(''); const [plate, setPlate] = useState(''); const [capacity, setCapacity] = useState('4');

  const load = useCallback(async () => {
    if (!isConfigured) { setLoading(false); return; }
    const { data: auth } = await supabase.auth.getUser(); const current = auth.user ?? null; setUser(current);
    if (!current) { setLoading(false); return; }
    const [roleResult, requestResult, identityResult, profileResult, vehicleResult, rideResult] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', current.id).eq('role', 'driver').maybeSingle(),
      supabase.from('role_requests').select('status').eq('user_id', current.id).eq('requested_role', 'driver').maybeSingle(),
      supabase.from('driver_verifications').select('status').eq('driver_id', current.id).maybeSingle(),
      supabase.from('driver_profiles').select('is_online,city_code').eq('driver_id', current.id).maybeSingle(),
      supabase.from('vehicles').select('id,vehicle_type,make,model,registration_number,capacity,verification').eq('driver_id', current.id).order('created_at', { ascending: false }),
      Promise.resolve({ data: [], error: null }),
    ]);
    setRole(Boolean(roleResult.data)); setRequestStatus(requestResult.data?.status ?? ''); setIdentity(identityResult.data?.status ?? 'not_submitted');
    const isOnline = Boolean(profileResult.data?.is_online);
    const [offersResult, assignedResult] = await Promise.all([
      roleResult.data && isOnline ? supabase.rpc('driver_poll_ride_offers') : Promise.resolve({ data: [], error: null }),
      supabase.from('rides').select('id,pickup_label,destination_label,status,driver_arrived_at,rider_no_show_at,estimated_fare_ngn_kobo,driver_earnings_ngn_kobo,currency,service_level,passenger_count,scheduled_for,created_at,driver_id').eq('driver_id',current.id).in('status',['accepted','in_progress','completed']).order('created_at',{ascending:false}).limit(100),
    ]);
    setOnline(isOnline); setCity(profileResult.data?.city_code ?? 'NG-DEFAULT'); setVehicles(vehicleResult.data ?? []);
    const combined = [...(offersResult.data ?? []), ...(assignedResult.data ?? [])];
    setRides([...new Map(combined.map((ride) => [ride.id, ride])).values()]); setLoading(false);
  }, []);

  useEffect(() => { const timer = setInterval(() => setClockNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!online || !role) return undefined; const timer = setInterval(() => load(), 12000); return () => clearInterval(timer); }, [online, role, load]);
  useEffect(() => { load(); const { data: listener } = supabase?.auth.onAuthStateChange(() => load()) ?? { data: {} }; return () => listener?.subscription?.unsubscribe(); }, [load]);
  useEffect(() => {
    if (!user) return undefined;
    const channel = supabase.channel(`mobile-driver-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, load]);
  useEffect(() => {
    let subscription; let cancelled = false;
    async function track() {
      const ride = rides.find((item) => item.driver_id === user?.id && ['accepted', 'in_progress'].includes(item.status));
      if (!online || !ride) return;
      const permission = await Location.requestForegroundPermissionsAsync(); if (!permission.granted || cancelled) return;
      subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 12000, distanceInterval: 30 }, (point) => {
        supabase.rpc('driver_update_ride_location', { p_ride_id: ride.id, p_latitude: point.coords.latitude, p_longitude: point.coords.longitude });
      });
    }
    track(); return () => { cancelled = true; subscription?.remove(); };
  }, [online, rides, user?.id]);

  async function apply() {
    if (!user) return router.push('/auth');
    setBusy(true); const { error } = await supabase.rpc('request_marketplace_role', { p_role: 'driver' }); setBusy(false);
    if (error) Alert.alert('Could not start driver registration', error.message); else { Alert.alert('Registration started', 'Upload an identity document so the team can review your driver account.'); await load(); }
  }

  async function uploadIdentity() {
    const picked = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    setBusy(true);
    try {
      const asset = picked.assets[0]; const id = newId();
      const { data: path, error: registerError } = await supabase.rpc('register_driver_document', { p_document_id: id, p_document_type: 'driver_identity' });
      if (registerError) throw registerError;
      const blob = await (await fetch(asset.uri)).blob();
      const { error: uploadError } = await supabase.storage.from('identity-documents').upload(path, blob, { contentType: asset.mimeType || 'application/octet-stream', upsert: false });
      if (uploadError) throw uploadError;
      const { error: submitError } = await supabase.rpc('submit_identity_for_review', { p_role: 'driver' });
      if (submitError) throw submitError;
      Alert.alert('Identity submitted', 'Your document is stored privately and is now awaiting review.'); await load();
    } catch (error) { Alert.alert('Upload not completed', error.message || 'Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  async function addVehicle() {
    if (!make.trim() || !model.trim() || !plate.trim()) return Alert.alert('Complete vehicle details', 'Add the make, model, and registration number.');
    setBusy(true); const { error } = await supabase.rpc('submit_driver_vehicle', { p_vehicle_type: vehicleType, p_make: make.trim(), p_model: model.trim(), p_registration_number: plate.trim(), p_capacity: Number(capacity) }); setBusy(false);
    if (error) Alert.alert('Vehicle not submitted', error.message); else { setMake(''); setModel(''); setPlate(''); Alert.alert('Vehicle submitted', 'It will remain unavailable for trips until an administrator approves it.'); await load(); }
  }

  async function availability(value) {
    setBusy(true);
    let result = await supabase.from('driver_profiles').select('driver_id').eq('driver_id', user.id).maybeSingle();
    if (!result.data && !result.error) result = await supabase.from('driver_profiles').insert({ driver_id: user.id });
    if (!result.error) result = await supabase.from('driver_profiles').update({ is_online: value, city_code: city }).eq('driver_id', user.id);
    setBusy(false); if (result.error) Alert.alert('Could not change availability', 'You need an approved driver identity and vehicle before going online.'); else { setOnline(value); await load(); }
  }
  async function tripAction(ride, action) {
    setBusy(true);
    const { error } = action === 'accept' ? await supabase.rpc('driver_accept_ride', { p_ride_id: ride.id })
      : action === 'decline' ? await supabase.rpc('driver_decline_ride_offer', { p_ride_id: ride.id })
      : action === 'decline' ? await supabase.rpc('driver_decline_ride_offer', { p_ride_id: ride.id })
      : action === 'arrived' ? await supabase.rpc('driver_mark_arrived', { p_ride_id: ride.id })
      : action === 'no_show' ? await supabase.rpc('driver_report_rider_no_show', { p_ride_id: ride.id })
      : await supabase.rpc('driver_update_ride_status', { p_ride_id: ride.id, p_new_status: action });
    setBusy(false);
    if (error) Alert.alert('Ride update failed', error.message); else await load();
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={navy}/></View>;
  if (!user) return <ScrollView contentContainerStyle={styles.page}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><View style={styles.panel}><Text style={styles.kicker}>DRIVE WITH MOVARA</Text><Text style={styles.title}>Work around your day.</Text><Text style={styles.copy}>Sign in to apply, submit your vehicle, and manage trips from one place.</Text><Pressable style={styles.button} onPress={() => router.push('/auth')}><Text style={styles.buttonText}>Sign in or create account</Text></Pressable></View></ScrollView>;

  const activeVehicles = vehicles.filter((item) => item.verification === 'approved');
  const assigned = rides.filter((ride) => ride.driver_id === user.id);
  const completed = assigned.filter((ride) => ride.status === 'completed');
  const available = rides.filter((ride) => !ride.driver_id && ['requested', 'matching'].includes(ride.status));
  const vehicleFits = (ride) => activeVehicles.some((vehicle) => vehicle.capacity >= ride.passenger_count && (vehicle.vehicle_type === 'car' || (vehicle.vehicle_type === 'keke' && ride.service_level === 'economy')) && (ride.service_level !== 'xl' || vehicle.capacity >= 6));
  const today = new Date(); today.setHours(0,0,0,0);
  const todayEarnings = completed.filter((ride) => new Date(ride.created_at) >= today).reduce((sum, ride) => sum + Number(ride.driver_earnings_ngn_kobo || 0), 0);

  return <ScrollView contentContainerStyle={styles.page}>
    <Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable>
    <Text style={styles.kicker}>DRIVER PARTNER</Text><Text style={styles.title}>Your driving day.</Text><Text style={styles.copy}>A clear view of your application, vehicle approvals, trips, and earnings.</Text>
    {!role ? <View style={styles.panel}><Text style={styles.section}>Start driving with MoVara</Text><Text style={styles.copy}>Apply for a driver account. Identity and vehicle approval are required before ride offers unlock.</Text>{(!requestStatus||requestStatus==='rejected')&&<Pressable style={styles.button} onPress={apply} disabled={busy}><Text style={styles.buttonText}>{busy?'Please wait…':requestStatus==='rejected'?'Submit a new application':'Apply to drive'}</Text></Pressable>}{requestStatus&&requestStatus!=='rejected'&&<><Text style={styles.status}>Application: {requestStatus.replaceAll('_',' ')}</Text>{identity!=='submitted'&&identity!=='approved'&&<Pressable style={styles.outlineButton} onPress={uploadIdentity} disabled={busy}><Text style={styles.outlineText}>{busy?'Uploading…':'Upload identity document'}</Text></Pressable>}<Text style={styles.hint}>Your application moves to review after you submit an identity document.</Text></>}</View> : <>
      <View style={styles.panel}><Text style={styles.section}>Identity review</Text><Text style={styles.copy}>Status: {identity.replaceAll('_',' ')}</Text>{identity !== 'approved' && identity !== 'submitted' && <Pressable style={styles.outlineButton} onPress={uploadIdentity} disabled={busy}><Text style={styles.outlineText}>{busy ? 'Uploading…' : 'Upload identity document'}</Text></Pressable>}<Text style={styles.hint}>Documents are private. Only you and authorized reviewers can access them.</Text></View>
      {identity === 'approved' && <View style={styles.panel}><Text style={styles.section}>Add your vehicle</Text><Text style={styles.copy}>Vehicle details are reviewed before they can receive matching trips.</Text><View style={styles.choiceRow}>{[['car','Car'],['keke','Keke']].map(([value,label])=><Pressable key={value} onPress={()=>setVehicleType(value)} style={[styles.choice,vehicleType===value&&styles.choiceActive]}><Text style={[styles.choiceText,vehicleType===value&&styles.choiceTextActive]}>{label}</Text></Pressable>)}</View><TextInput style={styles.input} placeholder="Make, for example Toyota" value={make} onChangeText={setMake}/><TextInput style={styles.input} placeholder="Model, for example Corolla" value={model} onChangeText={setModel}/><TextInput style={styles.input} placeholder="Registration number" autoCapitalize="characters" value={plate} onChangeText={setPlate}/><TextInput style={styles.input} placeholder="Passenger capacity" keyboardType="number-pad" value={capacity} onChangeText={setCapacity}/><Pressable style={styles.button} onPress={addVehicle} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Submitting…' : 'Submit vehicle for review'}</Text></Pressable></View>}
      {vehicles.map((vehicle)=><View style={styles.vehicle} key={vehicle.id}><Text style={styles.vehicleName}>{vehicle.make} {vehicle.model}</Text><Text style={styles.copy}>{vehicle.registration_number} · {vehicle.capacity} seats · {vehicle.vehicle_type}</Text><Text style={styles.status}>Review: {vehicle.verification.replaceAll('_',' ')}</Text></View>)}
      {role && <><View style={styles.metricRow}><View style={styles.metric}><Text style={styles.hint}>Today</Text><Text style={styles.metricValue}>{money(todayEarnings)}</Text></View><View style={styles.metric}><Text style={styles.hint}>Completed trips</Text><Text style={styles.metricValue}>{completed.length}</Text></View></View><Pressable style={[styles.button,online&&styles.offline]} onPress={()=>availability(!online)} disabled={busy||activeVehicles.length===0}><Text style={styles.buttonText}>{activeVehicles.length===0?'Vehicle approval required':online?'Go offline':'Go online'}</Text></Pressable>
        <Text style={styles.section}>Available ride offers</Text>{online&&activeVehicles.length>0?available.filter(vehicleFits).map((ride)=><View style={styles.ride} key={ride.id}><Text style={styles.rideTitle}>{ride.service_level.toUpperCase()} · {money(ride.estimated_fare_ngn_kobo)}</Text><Text style={styles.copy}>{ride.pickup_label} → {ride.destination_label}</Text><Text style={styles.hint}>{ride.passenger_count} passengers · {ride.scheduled_for ? `Scheduled ${new Date(ride.scheduled_for).toLocaleString()}` : 'Request now'} · Offers expire after 25 seconds</Text><Pressable style={styles.outlineButton} onPress={()=>tripAction(ride,'accept')} disabled={busy}><Text style={styles.outlineText}>Accept ride</Text></Pressable><Pressable style={styles.outlineButton} onPress={()=>tripAction(ride,'decline')} disabled={busy}><Text style={styles.outlineText}>Decline offer</Text></Pressable></View>):<Text style={styles.copy}>{activeVehicles.length===0?'Submit a vehicle and wait for approval to unlock ride matching.':online?'No eligible ride offers in this market right now.':'Go online when you are ready to receive eligible offers.'}</Text>}
        <Text style={styles.section}>Your trips</Text>{assigned.filter((ride)=>ride.status!=='completed').map((ride)=><View style={styles.ride} key={ride.id}><Text style={styles.rideTitle}>{ride.status.replaceAll('_',' ').toUpperCase()}</Text><Text style={styles.copy}>{ride.pickup_label} → {ride.destination_label}</Text>{ride.status==='accepted'&&!ride.driver_arrived_at&&<Pressable style={styles.button} onPress={()=>tripAction(ride,'arrived')} disabled={busy}><Text style={styles.buttonText}>I have arrived</Text></Pressable>}{ride.status==='accepted'&&ride.driver_arrived_at&&<><Text style={styles.hint}>Arrival shared at {new Date(ride.driver_arrived_at).toLocaleTimeString()}. No-show reports unlock after five minutes.</Text><Pressable style={styles.outlineButton} onPress={()=>Alert.alert('Report rider no-show?','Only continue if you are at the pickup and the rider has not arrived.',[{text:'Keep waiting',style:'cancel'},{text:'Report no-show',style:'destructive',onPress:()=>tripAction(ride,'no_show')}])} disabled={busy||clockNow<new Date(ride.driver_arrived_at).getTime()+5*60_000}><Text style={styles.outlineText}>Report rider no-show</Text></Pressable><Pressable style={styles.button} onPress={()=>tripAction(ride,'in_progress')} disabled={busy}><Text style={styles.buttonText}>Start trip</Text></Pressable></>}{ride.status==='in_progress'&&<Pressable style={styles.button} onPress={()=>tripAction(ride,'completed')} disabled={busy}><Text style={styles.buttonText}>Complete trip</Text></Pressable>}</View>)}
      </>}
    </>}
  </ScrollView>;
}

const styles=StyleSheet.create({page:{flexGrow:1,backgroundColor:'#F6F3ED',padding:22,paddingTop:54,paddingBottom:56,gap:14},center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:'#F6F3ED'},back:{color:navy,fontWeight:'600',fontSize:16,marginBottom:8},kicker:{color:'#A48652',fontWeight:'700',letterSpacing:1.5,fontSize:11},title:{color:navy,fontSize:34,fontWeight:'700',marginTop:-8},copy:{color:'#727A82',lineHeight:21,marginTop:4},panel:{backgroundColor:'white',padding:18,borderRadius:18,borderWidth:1,borderColor:'#E8E3DB',gap:8},section:{fontSize:20,color:navy,fontWeight:'700',marginTop:10},button:{backgroundColor:navy,borderRadius:12,padding:15,alignItems:'center',marginTop:8},buttonText:{color:'white',fontWeight:'700'},outlineButton:{borderColor:navy,borderWidth:1,borderRadius:11,padding:13,alignItems:'center',marginTop:7},outlineText:{color:navy,fontWeight:'700'},hint:{color:'#858C94',fontSize:12,lineHeight:18,marginTop:3},input:{height:50,borderWidth:1,borderColor:'#E3DED7',borderRadius:11,paddingHorizontal:13,color:navy,marginTop:6},choiceRow:{flexDirection:'row',gap:8},choice:{paddingVertical:10,paddingHorizontal:18,borderRadius:22,backgroundColor:'#F1EEE7'},choiceActive:{backgroundColor:navy},choiceText:{color:navy,fontWeight:'600'},choiceTextActive:{color:'white'},vehicle:{backgroundColor:'white',borderRadius:14,padding:15,borderWidth:1,borderColor:'#E8E3DB'},vehicleName:{fontSize:16,fontWeight:'700',color:navy},status:{color:'#8B6D35',fontSize:12,fontWeight:'700',marginTop:6},metricRow:{flexDirection:'row',gap:10},metric:{flex:1,backgroundColor:'white',borderRadius:14,padding:14,borderWidth:1,borderColor:'#E8E3DB'},metricValue:{color:navy,fontSize:20,fontWeight:'700',marginTop:4},offline:{backgroundColor:'#677382'},ride:{backgroundColor:'white',borderRadius:14,padding:15,borderWidth:1,borderColor:'#E8E3DB',marginTop:8},rideTitle:{color:navy,fontWeight:'700',fontSize:15}});
