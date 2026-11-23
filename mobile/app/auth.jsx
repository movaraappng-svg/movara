import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { AppText as Text } from '../src/AppText';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { isConfigured, supabase } from '../src/supabase';

WebBrowser.maybeCompleteAuthSession();
const navy = '#172F4E';
function GoogleMark() {
  return <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityLabel="Google">
    <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
    <Path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.12-1.43.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84z" />
    <Path fill="#EA4335" d="M12 5.37c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.08 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.84C6.71 7.3 9.14 5.37 12 5.37z" />
  </Svg>;
}
export default function AuthScreen() {
  const [mode, setMode] = useState('signin'); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!isConfigured) return Alert.alert('Setup needed', 'Add the Supabase settings in mobile/.env first.');
    setBusy(true);
    try {
      const result = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() }, emailRedirectTo: Linking.createURL('auth/callback') } });
      if (result.error) return Alert.alert('Could not continue', result.error.message);
      if (mode === 'signup' && !result.data.session) return Alert.alert('Check your email', 'Use the confirmation link we sent to finish creating your account.');
      router.replace('/');
    } catch (error) {
      Alert.alert('Could not continue', error?.message || 'Please check your connection and try again.');
    } finally { setBusy(false); }
  }
  async function google() {
    if (!isConfigured) return Alert.alert('Setup needed', 'Add the Supabase settings in mobile/.env first.');
    const redirectTo = Linking.createURL('auth/callback');
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
      if (error) return Alert.alert('Google sign-in unavailable', error.message);
      if (!data.url) return Alert.alert('Google sign-in unavailable', 'Please try again in a moment.');
      const response = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (response.type !== 'success') return;
      const url = new URL(response.url);
      const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
      if (oauthError) return Alert.alert('Google sign-in could not finish', oauthError);
      const code = url.searchParams.get('code');
      if (!code) return Alert.alert('Sign-in incomplete', 'Please try Google sign-in again.');
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) return Alert.alert('Could not finish sign-in', exchangeError.message);
      router.replace('/');
    } catch (error) {
      Alert.alert('Google sign-in unavailable', error?.message || 'Please check your connection and try again.');
    } finally { setBusy(false); }
  }
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable>
    <View style={styles.panel}>
      <Image source={require('../assets/branding/movara-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="MoVara. Your City. Your Home. Your Journey." />
      <Text style={styles.kicker}>WELCOME TO MoVara</Text>
      <Text style={styles.title}>{mode === 'signin' ? 'Good to see you.' : 'Let’s get you started.'}</Text>
      <Text style={styles.copy}>{mode === 'signin' ? 'Sign in to pick up where you left off with rides, homes, and your account.' : 'Create an account to save your rides, home search, and profile details.'}</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'signin' }} onPress={() => setMode('signin')} style={[styles.tab, mode === 'signin' && styles.active]}><Text style={styles.tabText}>Sign in</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'signup' }} onPress={() => setMode('signup')} style={[styles.tab, mode === 'signup' && styles.active]}><Text style={styles.tabText}>Create account</Text></Pressable>
      </View>
      <Text style={[styles.copy,{fontSize:12,marginTop:-10,marginBottom:10}]}>{mode === 'signin' ? 'Enter the email address and password you used to join MoVara.' : 'Use an email address you can open. We’ll send a confirmation link before your account is ready.'}</Text>
      {mode === 'signup' && <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name" autoComplete="name" accessibilityLabel="Full name"/>}
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" accessibilityLabel="Email address"/>
      <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'} secureTextEntry autoCapitalize="none" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} accessibilityLabel="Password"/>
      {mode === 'signup' && <Text style={[styles.copy,{fontSize:12,marginTop:-5}]}>Use at least 8 characters. After signing up, check your inbox and confirm your email.</Text>}
      <Pressable style={styles.button} onPress={submit} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</Text></Pressable>
      <Text style={styles.or}>OR</Text>
      <Pressable style={[styles.google,{flexDirection:'row',gap:10,justifyContent:'center'}]} onPress={google} disabled={busy} accessibilityRole="button" accessibilityLabel="Continue with Google"><GoogleMark/><Text style={styles.googleText}>{busy ? 'Connecting…' : 'Continue with Google'}</Text></Pressable>
      <Text style={styles.foot}>{mode === 'signup' ? 'Your email confirmation helps keep your MoVara account secure.' : 'Your MoVara account keeps your details together wherever you go.'}</Text>
    </View>
  </ScrollView>;
}
const styles = StyleSheet.create({ page: { flexGrow: 1, backgroundColor: '#F6F3ED', padding: 22, paddingTop: 56, paddingBottom: 48 }, back: { color: navy, fontSize: 16, fontWeight: '600', marginBottom: 26 }, panel: { backgroundColor: 'white', borderRadius: 22, padding: 22, borderWidth: 1, borderColor: '#E8E3DB' }, logo: { width: 126, height: 126, alignSelf: 'center', borderRadius: 20, backgroundColor: '#081C3A', marginBottom: 16 }, kicker: { color: '#A48652', letterSpacing: 1.5, fontWeight: '700', fontSize: 11 }, title: { color: navy, fontWeight: '700', fontSize: 30, marginTop: 10 }, copy: { color: '#727A82', marginTop: 7, lineHeight: 21 }, tabs: { flexDirection: 'row', backgroundColor: '#F2F0EC', borderRadius: 12, padding: 4, marginVertical: 20 }, tab: { flex: 1, padding: 11, borderRadius: 9, alignItems: 'center' }, active: { backgroundColor: 'white' }, tabText: { color: navy, fontWeight: '600' }, input: { minHeight: 54, borderWidth: 1, borderColor: '#E3DED7', borderRadius: 13, paddingHorizontal: 14, marginBottom: 11, color: navy }, button: { backgroundColor: navy, borderRadius: 13, padding: 16, alignItems: 'center', marginTop: 8 }, buttonText: { color: 'white', fontWeight: '700', fontSize: 16 }, or: { color: '#858A90', textAlign: 'center', marginVertical: 17, fontSize: 12 }, google: { backgroundColor: '#F3F3F3', borderRadius: 13, padding: 15, alignItems: 'center' }, googleText: { color: navy, fontWeight: '600' }, foot: { color: '#828890', textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 17 } });
