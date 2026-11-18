import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../src/AppText';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { isConfigured, supabase } from '../src/supabase';

WebBrowser.maybeCompleteAuthSession();
const navy = '#172F4E';
export default function AuthScreen() {
  const [mode, setMode] = useState('signin'); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!isConfigured) return Alert.alert('Setup needed', 'Add the Supabase settings in mobile/.env first.');
    setBusy(true);
    const result = mode === 'signin' ? await supabase.auth.signInWithPassword({ email: email.trim(), password }) : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() } } });
    setBusy(false);
    if (result.error) return Alert.alert('Could not continue', result.error.message);
    if (mode === 'signup' && !result.data.session) return Alert.alert('Check your email', 'Use the confirmation link we sent to finish creating your account.');
    router.replace('/');
  }
  async function google() {
    if (!isConfigured) return Alert.alert('Setup needed', 'Add the Supabase settings in mobile/.env first.');
    const redirectTo = Linking.createURL('auth/callback');
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
    if (error) return Alert.alert('Google sign-in unavailable', error.message);
    const response = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (response.type !== 'success') return;
    const url = new URL(response.url); const code = url.searchParams.get('code');
    if (!code) return Alert.alert('Sign-in incomplete', 'Please try Google sign-in again.');
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return Alert.alert('Could not finish sign-in', exchangeError.message);
    router.replace('/');
  }
  return <ScrollView contentContainerStyle={styles.page}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><View style={styles.panel}><Text style={styles.kicker}>WELCOME TO MOVARA</Text><Text style={styles.title}>{mode === 'signin' ? 'Good to see you.' : 'Let’s get you started.'}</Text><Text style={styles.copy}>Keep your journeys and home search together.</Text><View style={styles.tabs}><Pressable onPress={() => setMode('signin')} style={[styles.tab, mode === 'signin' && styles.active]}><Text style={styles.tabText}>Sign in</Text></Pressable><Pressable onPress={() => setMode('signup')} style={[styles.tab, mode === 'signup' && styles.active]}><Text style={styles.tabText}>Create account</Text></Pressable></View>{mode === 'signup' && <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name"/>}<TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address"/><TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password, at least 8 characters" secureTextEntry autoCapitalize="none"/><Pressable style={styles.button} onPress={submit} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</Text></Pressable><Text style={styles.or}>OR</Text><Pressable style={styles.google} onPress={google}><Text style={styles.googleText}>Continue with Google</Text></Pressable><Text style={styles.foot}>A secure account lets you save rides, enquiries and profile details.</Text></View></ScrollView>;
}
const styles = StyleSheet.create({ page: { flexGrow: 1, backgroundColor: '#F6F3ED', padding: 22, paddingTop: 56, paddingBottom: 48 }, back: { color: navy, fontSize: 16, fontWeight: '600', marginBottom: 26 }, panel: { backgroundColor: 'white', borderRadius: 22, padding: 22, borderWidth: 1, borderColor: '#E8E3DB' }, kicker: { color: '#A48652', letterSpacing: 1.5, fontWeight: '700', fontSize: 11 }, title: { color: navy, fontWeight: '700', fontSize: 30, marginTop: 10 }, copy: { color: '#727A82', marginTop: 7, lineHeight: 21 }, tabs: { flexDirection: 'row', backgroundColor: '#F2F0EC', borderRadius: 12, padding: 4, marginVertical: 20 }, tab: { flex: 1, padding: 11, borderRadius: 9, alignItems: 'center' }, active: { backgroundColor: 'white' }, tabText: { color: navy, fontWeight: '600' }, input: { minHeight: 54, borderWidth: 1, borderColor: '#E3DED7', borderRadius: 13, paddingHorizontal: 14, marginBottom: 11, color: navy }, button: { backgroundColor: navy, borderRadius: 13, padding: 16, alignItems: 'center', marginTop: 8 }, buttonText: { color: 'white', fontWeight: '700', fontSize: 16 }, or: { color: '#858A90', textAlign: 'center', marginVertical: 17, fontSize: 12 }, google: { backgroundColor: '#F3F3F3', borderRadius: 13, padding: 15, alignItems: 'center' }, googleText: { color: navy, fontWeight: '600' }, foot: { color: '#828890', textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 17 } });
