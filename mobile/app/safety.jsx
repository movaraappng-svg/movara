import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppText as Text } from '../src/AppText';
import { router } from 'expo-router';
import { supabase, isConfigured } from '../src/supabase';

const navy = '#172F4E';
const categories = ['ride_issue', 'payment', 'lost_item', 'account', 'property', 'other'];
const categoryLabel = (category) => category.replaceAll('_', ' ');

export default function SafetyScreen() {
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true); const [contacts, setContacts] = useState([]); const [rides, setRides] = useState([]); const [tickets, setTickets] = useState([]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [relationship, setRelationship] = useState(''); const [category, setCategory] = useState('ride_issue'); const [message, setMessage] = useState(''); const [rideId, setRideId] = useState(null); const [busy, setBusy] = useState(false); const [openTicket, setOpenTicket] = useState(null); const [ticketMessages, setTicketMessages] = useState([]); const [reply, setReply] = useState('');

  async function load() {
    if (!isConfigured) { setLoading(false); setUser(null); return; }
    const { data: session } = await supabase.auth.getUser(); const currentUser = session.user;
    setUser(currentUser);
    if (!currentUser) { setLoading(false); return; }
    const [contactResult, rideResult, ticketResult] = await Promise.all([
      supabase.from('emergency_contacts').select('id,name,phone,relationship,created_at').order('created_at'),
      supabase.from('rides').select('id,pickup_label,destination_label,status,created_at').eq('customer_id', currentUser.id).order('created_at', { ascending: false }).limit(20),
      supabase.rpc('my_support_tickets'),
    ]);
    if (contactResult.error || rideResult.error || ticketResult.error) Alert.alert('Some safety details could not load', 'Pull to refresh or try again later.');
    setContacts(contactResult.data ?? []); setRides(rideResult.data ?? []); setTickets(ticketResult.data ?? []); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function addContact() {
    if (!name.trim() || !phone.trim()) return Alert.alert('Add contact details', 'Name and phone number are required.');
    setBusy(true); const { error } = await supabase.from('emergency_contacts').insert({ user_id: user.id, name: name.trim(), phone: phone.trim(), relationship: relationship.trim() || null }); setBusy(false);
    if (error) return Alert.alert('Contact not saved', 'Check the details and try again.');
    setName(''); setPhone(''); setRelationship(''); await load();
  }
  async function removeContact(contact) {
    Alert.alert('Remove emergency contact?', `Remove ${contact.name} from your list?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { const { error } = await supabase.from('emergency_contacts').delete().eq('id', contact.id); if (error) Alert.alert('Could not remove contact'); else load(); } }]);
  }
  async function sendTicket() {
    if (!message.trim() || message.trim().length < 5) return Alert.alert('Add more detail', 'Describe what happened in at least a few words.');
    setBusy(true); const { error } = await supabase.rpc('create_support_ticket', { p_category: category, p_message: message.trim(), p_ride_id: rideId }); setBusy(false);
    if (error) return Alert.alert('Request not sent', 'Please try again when your connection is available.');
    setMessage(''); setRideId(null); await load(); Alert.alert('Support request sent', 'You can follow replies in your support history.');
  }
  async function toggleTicket(ticket) {
    if (openTicket === ticket.id) { setOpenTicket(null); return; }
    setOpenTicket(ticket.id); const { data } = await supabase.rpc('my_support_messages', { p_ticket_id: ticket.id }); setTicketMessages(data ?? []);
  }
  async function sendReply(ticket) {
    if (!reply.trim()) return;
    setBusy(true); const { error } = await supabase.rpc('add_support_reply', { p_ticket_id: ticket.id, p_body: reply.trim() }); setBusy(false);
    if (error) return Alert.alert('Reply not sent', 'This request may be closed. Refresh and try again.');
    setReply(''); const { data } = await supabase.rpc('my_support_messages', { p_ticket_id: ticket.id }); setTicketMessages(data ?? []);
  }
  async function callEmergency(ride) {
    Alert.alert('Call emergency services?', 'If you are in immediate danger, contact Nigeria’s emergency number 112. MoVara records this safety report but does not dispatch emergency services.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Call 112', style: 'destructive', onPress: async () => {
      if (ride) { const { error } = await supabase.rpc('report_ride_safety_event', { p_ride_id: ride.id, p_event_type: 'sos', p_message: 'Customer requested emergency assistance.' }); if (error) Alert.alert('Safety report could not be saved', 'Call emergency services directly if needed.'); }
      Linking.openURL('tel:112').catch(() => Alert.alert('Call unavailable', 'Dial 112 directly from your phone.'));
    } }]);
  }

  if (loading) return <View style={styles.loading}><ActivityIndicator color={navy}/></View>;
  if (!user) return <ScrollView contentContainerStyle={styles.page}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><View style={styles.panel}><Text style={styles.title}>Safety and support</Text><Text style={styles.copy}>{isConfigured ? 'Sign in to manage emergency contacts and support requests.' : 'Account services are not configured for this app yet.'}</Text>{isConfigured && <Pressable style={styles.button} onPress={() => router.push('/auth')}><Text style={styles.buttonText}>Sign in</Text></Pressable>}</View></ScrollView>;
  const activeRide = rides.find((ride) => ['accepted','in_progress'].includes(ride.status));
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled"><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></Pressable><Text style={styles.kicker}>HERE WHEN YOU NEED US</Text><Text style={styles.title}>Safety and support</Text><Text style={styles.copy}>Keep trusted people close and tell our team when something needs attention.</Text>
    <View style={styles.emergency}><Text style={styles.emergencyTitle}>Immediate danger?</Text><Text style={styles.emergencyCopy}>Call 112 for emergency services. MoVara does not dispatch emergency responders.</Text><Pressable style={styles.emergencyButton} onPress={() => callEmergency(activeRide)}><Text style={styles.emergencyButtonText}>Call 112</Text></Pressable>{activeRide && <Text style={styles.emergencyCopy}>Your active ride will be attached to a safety report.</Text>}</View>
    <View style={styles.panel}><Text style={styles.sectionTitle}>Emergency contacts</Text><Text style={styles.copy}>Saved privately to your account. Contact them directly when needed.</Text><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name"/><TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Phone number" keyboardType="phone-pad"/><TextInput style={styles.input} value={relationship} onChangeText={setRelationship} placeholder="Relationship (optional)"/><Pressable style={styles.button} onPress={addContact} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Saving…' : 'Add contact'}</Text></Pressable>{contacts.map((contact) => <View style={styles.contact} key={contact.id}><View style={{ flex: 1 }}><Text style={styles.contactName}>{contact.name}</Text><Text style={styles.subtle}>{contact.phone}{contact.relationship ? ` · ${contact.relationship}` : ''}</Text></View><Pressable onPress={() => Linking.openURL(`tel:${contact.phone}`)}><Text style={styles.action}>Call</Text></Pressable><Pressable onPress={() => removeContact(contact)}><Text style={styles.remove}>Remove</Text></Pressable></View>)}{contacts.length === 0 && <Text style={styles.subtle}>No emergency contacts saved.</Text>}</View>
    <View style={styles.panel}><Text style={styles.sectionTitle}>Contact support</Text><Text style={styles.copy}>Choose what happened and include a ride if it is related to a trip.</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryStrip}>{categories.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.category, category === item && styles.categorySelected]}><Text style={styles.categoryText}>{categoryLabel(item)}</Text></Pressable>)}</ScrollView>{rides.length > 0 && <><Text style={styles.fieldLabel}>Related ride (optional)</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{rides.slice(0, 8).map((ride) => <Pressable key={ride.id} onPress={() => setRideId(rideId === ride.id ? null : ride.id)} style={[styles.rideChip, rideId === ride.id && styles.categorySelected]}><Text style={styles.categoryText}>{ride.pickup_label} to {ride.destination_label}</Text></Pressable>)}</ScrollView></>}<TextInput style={[styles.input, styles.message]} value={message} onChangeText={setMessage} multiline maxLength={4000} placeholder="Tell us what happened" textAlignVertical="top"/><Pressable style={styles.button} onPress={sendTicket} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Sending…' : 'Send to support'}</Text></Pressable></View>
    <View style={styles.historyHeader}><Text style={styles.sectionTitle}>Support history</Text><Pressable onPress={load}><Text style={styles.action}>Refresh</Text></Pressable></View>{tickets.map((ticket) => <View key={ticket.id} style={styles.ticket}><Pressable onPress={() => toggleTicket(ticket)}><View style={styles.ticketTop}><Text style={styles.ticketTitle}>{categoryLabel(ticket.category)}</Text><Text style={styles.status}>{ticket.status.replaceAll('_',' ')}</Text></View><Text style={styles.ticketMessage}>{ticket.message}</Text><Text style={styles.subtle}>{new Date(ticket.created_at).toLocaleString()} {ticket.resolution ? `· ${ticket.resolution}` : ''}</Text></Pressable>{openTicket === ticket.id && <View style={styles.thread}>{ticketMessages.map((item) => <View key={item.id} style={styles.threadMessage}><Text style={styles.ticketMessage}>{item.body}</Text><Text style={styles.subtle}>{new Date(item.created_at).toLocaleString()}</Text></View>)}{ticket.status !== 'closed' && <><TextInput style={styles.input} value={reply} onChangeText={setReply} maxLength={4000} placeholder="Reply to support"/><Pressable onPress={() => sendReply(ticket)} disabled={busy}><Text style={styles.action}>{busy ? 'Sending…' : 'Send reply'}</Text></Pressable></>}</View>}</View>)}{tickets.length === 0 && <Text style={styles.subtle}>No support requests yet.</Text>}
  </ScrollView>;
}

const styles = StyleSheet.create({ page: { flexGrow: 1, backgroundColor: '#F6F3ED', padding: 22, paddingTop: 56, paddingBottom: 48 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F3ED' }, back: { color: navy, fontSize: 16, fontWeight: '600', marginBottom: 26 }, kicker: { color: '#A48652', letterSpacing: 1.5, fontWeight: '700', fontSize: 11 }, title: { color: navy, fontWeight: '700', fontSize: 34, marginTop: 8 }, copy: { color: '#727A82', marginTop: 7, marginBottom: 14, lineHeight: 21 }, panel: { backgroundColor: 'white', borderRadius: 19, borderWidth: 1, borderColor: '#E8E3DB', padding: 17, marginTop: 14 }, emergency: { backgroundColor: '#F8E9E6', borderColor: '#E7C4BE', borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 12 }, emergencyTitle: { color: '#873F3A', fontSize: 19, fontWeight: '700' }, emergencyCopy: { color: '#765E5B', lineHeight: 19, marginTop: 7, fontSize: 13 }, emergencyButton: { backgroundColor: '#A5443F', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 13 }, emergencyButtonText: { color: 'white', fontWeight: '700', fontSize: 16 }, sectionTitle: { color: navy, fontSize: 20, fontWeight: '700' }, input: { backgroundColor: 'white', minHeight: 50, borderRadius: 12, paddingHorizontal: 13, marginTop: 9, borderWidth: 1, borderColor: '#E3DED7', color: navy, fontSize: 14 }, button: { backgroundColor: navy, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 11 }, buttonText: { color: 'white', fontWeight: '700' }, contact: { flexDirection: 'row', alignItems: 'center', gap: 14, borderTopWidth: 1, borderColor: '#EEEAE4', paddingTop: 12, marginTop: 13 }, contactName: { color: navy, fontWeight: '700' }, subtle: { color: '#777F87', fontSize: 12, lineHeight: 18, marginTop: 4 }, action: { color: navy, fontWeight: '700', padding: 4 }, remove: { color: '#A64748', fontWeight: '600', padding: 4 }, categoryStrip: { marginVertical: 9 }, category: { backgroundColor: '#F5F3EF', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginRight: 7 }, categorySelected: { backgroundColor: '#E8EDF3', borderColor: navy, borderWidth: 1 }, categoryText: { color: navy, fontSize: 12, textTransform: 'capitalize', maxWidth: 190 }, fieldLabel: { color: navy, fontWeight: '600', marginTop: 7 }, rideChip: { backgroundColor: '#F5F3EF', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 9, marginRight: 7, marginTop: 8 }, message: { height: 110, paddingTop: 12 }, historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 23 }, ticket: { backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: '#E8E3DB', padding: 14, marginTop: 10 }, ticketTop: { flexDirection: 'row', justifyContent: 'space-between' }, ticketTitle: { color: navy, fontWeight: '700', textTransform: 'capitalize' }, status: { color: '#58724D', textTransform: 'capitalize', fontSize: 12, fontWeight: '600' }, ticketMessage: { color: navy, lineHeight: 20, marginTop: 8 }, thread: { borderTopWidth: 1, borderColor: '#E8E3DB', marginTop: 12, paddingTop: 10 }, threadMessage: { backgroundColor: '#F4F2EC', borderRadius: 11, padding: 10, marginBottom: 8 } });
