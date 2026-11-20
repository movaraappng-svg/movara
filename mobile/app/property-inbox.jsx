import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../src/AppText';
import { router } from 'expo-router';
import { isConfigured, supabase } from '../src/supabase';

const navy = '#172F4E';
export default function PropertyInboxScreen() {
  const [user, setUser] = useState(null); const [threads, setThreads] = useState([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(null); const [drafts, setDrafts] = useState({});
  async function load() {
    if (!isConfigured) { setLoading(false); return; }
    const { data: session } = await supabase.auth.getUser(); const currentUser = session.user; setUser(currentUser);
    if (!currentUser) { setThreads([]); setLoading(false); return; }
    const { data: enquiries, error } = await supabase.from('enquiries').select('id,property_id,landlord_id,customer_id,last_message_at,created_at').or(`customer_id.eq.${currentUser.id},landlord_id.eq.${currentUser.id}`).order('last_message_at', { ascending: false }).limit(100);
    if (error) { Alert.alert('Messages unavailable', 'Please try again.'); setLoading(false); return; }
    if (!enquiries?.length) { setThreads([]); setLoading(false); return; }
    const ids = enquiries.map((item) => item.id); const propertyIds = [...new Set(enquiries.map((item) => item.property_id))];
    const [messageResult, viewingResult, propertyResult] = await Promise.all([
      supabase.from('enquiry_messages').select('id,enquiry_id,sender_id,body,created_at').in('enquiry_id', ids).order('created_at'),
      supabase.from('property_viewings').select('id,enquiry_id,proposed_at,status,requested_by').in('enquiry_id', ids).order('proposed_at'),
      supabase.from('properties').select('id,title').in('id', propertyIds),
    ]);
    const propertyMap = Object.fromEntries((propertyResult.data ?? []).map((item) => [item.id, item.title]));
    setThreads(enquiries.map((item) => ({ ...item, title: propertyMap[item.property_id] ?? 'Home listing', messages: (messageResult.data ?? []).filter((message) => message.enquiry_id === item.id), viewings: (viewingResult.data ?? []).filter((viewing) => viewing.enquiry_id === item.id) })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  async function replyTo(event, thread) {
    event.preventDefault?.(); const body = (drafts[thread.id] ?? '').trim(); if (!body) return;
    setBusy(thread.id); const { error } = await supabase.rpc('send_enquiry_message', { p_enquiry_id: thread.id, p_body: body, p_idempotency_key: createKey() }); setBusy(null);
    if (error) return Alert.alert('Reply not sent', 'Please check your connection and try again.');
    setDrafts((current) => ({ ...current, [thread.id]: '' })); await load();
  }
  async function confirmViewing(viewing) {
    setBusy(viewing.id); const { error } = await supabase.rpc('confirm_property_viewing', { p_viewing_id: viewing.id }); setBusy(null);
    if (error) return Alert.alert('Viewing not updated', 'Refresh and try again.'); await load();
  }
  if (loading) return <View style={styles.loading}><ActivityIndicator color={navy}/></View>;
  if (!user) return <ScrollView contentContainerStyle={styles.page}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><View style={styles.panel}><Text style={styles.title}>Property messages</Text><Text style={styles.copy}>Sign in to view home enquiries and messages.</Text><Pressable style={styles.button} onPress={() => router.push('/auth')}><Text style={styles.buttonText}>Sign in</Text></Pressable></View></ScrollView>;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled"><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><Text style={styles.kicker}>YOUR HOME SEARCH</Text><Text style={styles.title}>Property messages</Text><Text style={styles.copy}>Enquiries and viewing plans in one place.</Text><Pressable onPress={load} style={styles.refresh}><Text style={styles.action}>Refresh conversations</Text></Pressable>
    {threads.map((thread) => <View style={styles.thread} key={thread.id}><Text style={styles.homeTitle}>{thread.title}</Text><Text style={styles.subtle}>Updated {new Date(thread.last_message_at).toLocaleString()}</Text>{thread.messages.map((message) => <View key={message.id} style={[styles.message, message.sender_id === user.id && styles.myMessage]}><Text style={styles.messageBody}>{message.body}</Text><Text style={styles.subtle}>{message.sender_id === user.id ? 'You' : 'Other participant'} · {new Date(message.created_at).toLocaleString()}</Text></View>)}{thread.viewings.map((viewing) => <View key={viewing.id} style={styles.viewing}><View style={{ flex: 1 }}><Text style={styles.viewingTitle}>Viewing {viewing.status}</Text><Text style={styles.subtle}>{new Date(viewing.proposed_at).toLocaleString()}</Text></View>{viewing.status === 'proposed' && <Pressable onPress={() => confirmViewing(viewing)} disabled={busy === viewing.id}><Text style={styles.action}>{busy === viewing.id ? 'Saving…' : 'Confirm'}</Text></Pressable>}</View>)}<View style={styles.replyRow}><TextInput style={styles.replyInput} value={drafts[thread.id] ?? ''} onChangeText={(value) => setDrafts((current) => ({ ...current, [thread.id]: value }))} placeholder="Write a reply" maxLength={5000}/><Pressable style={styles.send} onPress={() => replyTo(null, thread)} disabled={busy === thread.id || !(drafts[thread.id] ?? '').trim()}><Text style={styles.sendText}>{busy === thread.id ? '…' : 'Send'}</Text></Pressable></View></View>)}
    {!threads.length && <View style={styles.panel}><Text style={styles.emptyTitle}>No property conversations yet</Text><Text style={styles.copy}>When you enquire about a home or receive a message, it will appear here.</Text><Pressable style={styles.button} onPress={() => router.push('/homes')}><Text style={styles.buttonText}>Explore homes</Text></Pressable></View>}
  </ScrollView>;
}
function createKey() { return globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => { const value = Math.random() * 16 | 0; return (char === 'x' ? value : (value & 3 | 8)).toString(16); }); }
const styles = StyleSheet.create({ page: { flexGrow: 1, backgroundColor: '#F6F3ED', padding: 22, paddingTop: 56, paddingBottom: 48 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F3ED' }, back: { color: navy, fontSize: 16, fontWeight: '600', marginBottom: 25 }, kicker: { color: '#A48652', fontWeight: '700', fontSize: 11, letterSpacing: 1.5 }, title: { color: navy, fontSize: 32, fontWeight: '700', marginTop: 8 }, copy: { color: '#727A82', lineHeight: 20, marginTop: 6, marginBottom: 10 }, refresh: { alignSelf: 'flex-start', paddingVertical: 8 }, action: { color: navy, fontWeight: '700' }, thread: { backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: '#E8E3DB', padding: 15, marginTop: 12 }, homeTitle: { color: navy, fontSize: 18, fontWeight: '700' }, subtle: { color: '#777F87', fontSize: 11, lineHeight: 16, marginTop: 4 }, message: { backgroundColor: '#F3F1EB', padding: 11, borderRadius: 12, marginTop: 10, alignSelf: 'flex-start', maxWidth: '94%' }, myMessage: { backgroundColor: '#E8EDF3', alignSelf: 'flex-end' }, messageBody: { color: navy, lineHeight: 19 }, viewing: { borderTopWidth: 1, borderColor: '#ECE8E2', paddingTop: 11, marginTop: 12, flexDirection: 'row', alignItems: 'center' }, viewingTitle: { color: navy, textTransform: 'capitalize', fontWeight: '600' }, replyRow: { flexDirection: 'row', gap: 7, marginTop: 13 }, replyInput: { flex: 1, minHeight: 45, backgroundColor: '#F8F7F4', borderRadius: 11, paddingHorizontal: 12, color: navy, borderWidth: 1, borderColor: '#E8E3DB' }, send: { backgroundColor: navy, borderRadius: 11, paddingHorizontal: 14, justifyContent: 'center' }, sendText: { color: 'white', fontWeight: '700' }, panel: { backgroundColor: 'white', borderRadius: 18, padding: 17, marginTop: 16 }, emptyTitle: { color: navy, fontWeight: '700', fontSize: 19 }, button: { backgroundColor: navy, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 9 }, buttonText: { color: 'white', fontWeight: '700' } });
