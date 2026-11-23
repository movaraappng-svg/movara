import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../src/AppText';
import { router } from 'expo-router';
import { isConfigured, supabase } from '../src/supabase';

const navy = '#172F4E';
export default function AccountScreen() {
  const [user, setUser] = useState(null); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; async function load() {
    if (!isConfigured) { setLoading(false); return; }
    const { data: session } = await supabase.auth.getUser(); if (!alive) return;
    setUser(session.user ?? null);
    if (session.user) { const { data } = await supabase.from('profiles').select('display_name,phone').eq('id', session.user.id).maybeSingle(); if (alive) { setName(data?.display_name ?? session.user.user_metadata?.full_name ?? ''); setPhone(data?.phone ?? ''); } }
    setLoading(false);
  } load(); return () => { alive = false; }; }, []);
  async function save() {
    if (!name.trim()) return Alert.alert('Add your name', 'Your name cannot be blank.');
    setBusy(true); const { error } = await supabase.from('profiles').update({ display_name: name.trim(), phone: phone.trim() || null }).eq('id', user.id); setBusy(false);
    if (error) Alert.alert('Profile not saved', 'Please try again when your connection is available.'); else Alert.alert('Profile saved', 'Your account details are up to date.');
  }
  async function signOut() { await supabase.auth.signOut(); router.replace('/'); }
  if (loading) return <View style={styles.loading}><ActivityIndicator color={navy}/></View>;
  if (!user) return <ScrollView contentContainerStyle={styles.page}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><View style={styles.panel}><Text style={styles.title}>Your account</Text><Text style={styles.copy}>{isConfigured ? 'Sign in to keep your profile and services together.' : 'Account services have not been configured.'}</Text>{isConfigured && <Pressable style={styles.button} onPress={() => router.push('/auth')}><Text style={styles.buttonText}>Sign in or create an account</Text></Pressable>}</View></ScrollView>;
  return <ScrollView contentContainerStyle={styles.page}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><Text style={styles.kicker}>YOUR MoVara ACCOUNT</Text><Text style={styles.title}>A few details about you.</Text><Text style={styles.copy}>{user.email}</Text><View style={styles.panel}><Text style={styles.label}>Full name</Text><TextInput style={styles.input} value={name} onChangeText={setName} maxLength={120} placeholder="Your name"/><Text style={styles.label}>Phone number</Text><TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={40} placeholder="+234…"/><Pressable style={styles.button} onPress={save} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save profile'}</Text></Pressable></View><View style={styles.links}>{[['Wallet','/wallet'],['Book a ride','/rides'],['Drive with MoVara','/driver'],['Find a home','/homes'],['List a property','/landlord'],['Property messages','/property-inbox'],['Notifications','/notifications'],['Safety and support','/safety']].map(([label, path]) => <Pressable style={styles.link} key={path} onPress={() => router.push(path)}><Text style={styles.linkText}>{label}  ›</Text></Pressable>)}</View><Pressable onPress={signOut} style={styles.signOut}><Text style={styles.signOutText}>Sign out</Text></Pressable></ScrollView>;
}
const styles = StyleSheet.create({ page: { flexGrow: 1, backgroundColor: '#F6F3ED', padding: 22, paddingTop: 56, paddingBottom: 48 }, loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F6F3ED' }, back: { color: navy, fontSize: 16, fontWeight: '600', marginBottom: 25 }, kicker: { color: '#A48652', fontWeight: '700', letterSpacing: 1.5, fontSize: 11 }, title: { color: navy, fontSize: 32, fontWeight: '700', marginTop: 8 }, copy: { color: '#727A82', lineHeight: 20, marginTop: 7, marginBottom: 12 }, panel: { backgroundColor: 'white', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#E8E3DB' }, label: { color: '#727A82', fontSize: 12, fontWeight: '600', marginTop: 9, marginBottom: 5 }, input: { minHeight: 52, borderWidth: 1, borderColor: '#E3DED7', borderRadius: 12, paddingHorizontal: 13, color: navy }, button: { backgroundColor: navy, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 15 }, buttonText: { color: 'white', fontWeight: '700' }, links: { marginTop: 14, backgroundColor: 'white', borderRadius: 16, paddingHorizontal: 14 }, link: { paddingVertical: 15, borderBottomWidth: 1, borderColor: '#EEEAE4' }, linkText: { color: navy, fontWeight: '600' }, signOut: { alignSelf: 'flex-start', padding: 12, marginTop: 12 }, signOutText: { color: '#A64748', fontWeight: '700' } });
