import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../src/AppText';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { router } from 'expo-router';
import { supabase, isConfigured } from '../src/supabase';

const navy = '#172F4E';
const options = [{ title: 'Standard car', fare: 3500 }, { title: 'Comfort car', fare: 5000 }, { title: 'Keke', fare: 1500 }];

export default function RidesScreen() {
  const [pickup, setPickup] = useState(''); const [destination, setDestination] = useState('');
  const [point, setPoint] = useState(null); const [vehicle, setVehicle] = useState(options[0]); const [busy, setBusy] = useState(false);
  async function currentLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return Alert.alert('Location permission needed', 'Allow location access to use your current position as pickup.');
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setPoint({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    const places = await Location.reverseGeocodeAsync(loc.coords).catch(() => []);
    const p = places[0];
    setPickup(p ? [p.name, p.street, p.city, p.region].filter(Boolean).join(', ') : `${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}`);
  }
  async function requestRide() {
    if (!pickup.trim() || !destination.trim()) return Alert.alert('Add your route', 'Enter both pickup and destination to continue.');
    if (!isConfigured) return Alert.alert('Setup needed', 'Add the Supabase settings in mobile/.env before requesting a ride.');
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); return Alert.alert('Sign in to continue', 'Sign in to save and manage your ride request.', [{ text: 'Later' }, { text: 'Sign in', onPress: () => router.push('/auth') }]); }
    const { error } = await supabase.from('rides').insert({ customer_id: user.id, pickup_label: pickup, destination_label: destination, passenger_count: 1, estimated_fare_ngn_kobo: vehicle.fare * 100, status: 'requested' });
    setBusy(false); Alert.alert(error ? 'Could not request ride' : 'Ride request received', error?.message ?? 'Your request has been saved to your account.');
  }
  return <ScrollView contentContainerStyle={styles.page}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><Text style={styles.kicker}>YOUR NEXT JOURNEY</Text><Text style={styles.title}>Book a ride</Text><Text style={styles.copy}>Choose where you are going and we’ll help you get there.</Text>
    <MapView style={styles.map} initialRegion={{ latitude: point?.latitude ?? 9.082, longitude: point?.longitude ?? 8.6753, latitudeDelta: point ? .04 : 12, longitudeDelta: point ? .04 : 12 }} region={point ? { latitude: point.latitude, longitude: point.longitude, latitudeDelta: .04, longitudeDelta: .04 } : undefined}>{point && <Marker coordinate={point} title="Your pickup" />}</MapView>
    <Pressable style={styles.location} onPress={currentLocation}><Text style={styles.locationText}>◎  Use my current location</Text></Pressable>
    <TextInput style={styles.input} value={pickup} onChangeText={setPickup} placeholder="Pickup location" placeholderTextColor="#8A9095"/><TextInput style={styles.input} value={destination} onChangeText={setDestination} placeholder="Destination" placeholderTextColor="#8A9095"/>
    <Text style={styles.heading}>Choose your ride</Text><Text style={styles.note}>Indicative starting fares, not live quotes.</Text>{options.map((item) => <Pressable key={item.title} onPress={() => setVehicle(item)} style={[styles.choice, vehicle.title === item.title && styles.selected]}><Text style={styles.choiceTitle}>{item.title}</Text><Text style={styles.choicePrice}>₦{item.fare.toLocaleString()}</Text></Pressable>)}
    <Pressable style={styles.button} onPress={requestRide} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Saving request…' : `Request ride · ₦${vehicle.fare.toLocaleString()}`}</Text></Pressable>
    <Text style={styles.note}>Driver matching and payments depend on available service partners in your area.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({ page: { flexGrow: 1, backgroundColor: '#F6F3ED', padding: 22, paddingTop: 56, paddingBottom: 48 }, back: { color: navy, fontSize: 16, fontWeight: '600', marginBottom: 26 }, kicker: { color: '#A48652', letterSpacing: 1.5, fontWeight: '700', fontSize: 11 }, title: { color: navy, fontSize: 36, fontWeight: '700', marginTop: 7 }, copy: { color: '#727A82', fontSize: 15, marginTop: 6, marginBottom: 20 }, map: { height: 230, borderRadius: 20, marginBottom: 12 }, location: { alignSelf: 'flex-start', paddingVertical: 8 }, locationText: { color: navy, fontWeight: '600' }, input: { backgroundColor: 'white', minHeight: 56, borderRadius: 13, paddingHorizontal: 15, marginTop: 10, borderWidth: 1, borderColor: '#E5E0D8', color: navy, fontSize: 15 }, heading: { color: navy, fontSize: 20, fontWeight: '700', marginTop: 26, marginBottom: 10 }, choice: { backgroundColor: 'white', padding: 16, borderRadius: 14, borderColor: '#E5E0D8', borderWidth: 1, marginBottom: 9, flexDirection: 'row', justifyContent: 'space-between' }, selected: { borderColor: navy, borderWidth: 1.5 }, choiceTitle: { color: navy, fontWeight: '600' }, choicePrice: { color: navy, fontWeight: '700' }, button: { backgroundColor: navy, borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 14 }, buttonText: { color: 'white', fontSize: 16, fontWeight: '700' }, note: { color: '#7E858C', lineHeight: 19, fontSize: 12, marginTop: 13 } });
