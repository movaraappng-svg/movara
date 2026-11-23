import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../src/AppText';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { Car01Icon, Home01Icon, ArrowRight01Icon, Shield01Icon, DeliveryBox01Icon } from '@hugeicons/core-free-icons';

const navy = '#142B4A';
const cream = '#F7F5F0';

export default function HomeScreen() {
  return <ScrollView contentContainerStyle={styles.page}>
    <View style={styles.header}><View><Text style={styles.logo}>MoVara</Text><Text style={styles.tag}>Your City. Your Home. Your Journey.</Text></View><Pressable onPress={() => router.push('/account')} style={styles.profileButton}><Text style={styles.profileText}>My account</Text></Pressable></View>
    <View style={styles.hero}><Text style={styles.eyebrow}>LIFE, IN MOTION</Text><Text style={styles.title}>Good days begin{ '\n' }with getting there.</Text><Text style={styles.copy}>Book a ride, find a place to call home, and make your next move with confidence.</Text></View>
    <Text style={styles.sectionTitle}>What brings you here?</Text>
    <View style={styles.cards}>
      <Pressable onPress={() => router.push('/rides')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><View style={styles.icon}><HugeiconsIcon icon={Car01Icon} size={25} color={navy} /></View><View style={styles.cardText}><Text style={styles.cardTitle}>Get there</Text><Text style={styles.cardCopy}>Find a ride for your day</Text></View><HugeiconsIcon icon={ArrowRight01Icon} size={20} color={navy} /></Pressable>
      <Pressable onPress={() => router.push('/cargo')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><View style={styles.icon}><HugeiconsIcon icon={DeliveryBox01Icon} size={25} color={navy} /></View><View style={styles.cardText}><Text style={styles.cardTitle}>Send something</Text><Text style={styles.cardCopy}>Book a courier and follow delivery</Text></View><HugeiconsIcon icon={ArrowRight01Icon} size={20} color={navy} /></Pressable>
      <Pressable onPress={() => router.push('/homes')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><View style={styles.icon}><HugeiconsIcon icon={Home01Icon} size={25} color={navy} /></View><View style={styles.cardText}><Text style={styles.cardTitle}>Find your place</Text><Text style={styles.cardCopy}>Explore homes across Nigeria</Text></View><HugeiconsIcon icon={ArrowRight01Icon} size={20} color={navy} /></Pressable>
      <Pressable onPress={() => router.push('/landlord')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><View style={styles.icon}><HugeiconsIcon icon={Home01Icon} size={25} color={navy} /></View><View style={styles.cardText}><Text style={styles.cardTitle}>List a property</Text><Text style={styles.cardCopy}>Manage your home listings and enquiries</Text></View><HugeiconsIcon icon={ArrowRight01Icon} size={20} color={navy} /></Pressable>
      <Pressable onPress={() => router.push('/driver')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><View style={styles.icon}><HugeiconsIcon icon={Car01Icon} size={25} color={navy} /></View><View style={styles.cardText}><Text style={styles.cardTitle}>Drive with MoVara</Text><Text style={styles.cardCopy}>Apply, manage trips, and track earnings</Text></View><HugeiconsIcon icon={ArrowRight01Icon} size={20} color={navy} /></Pressable>
      <Pressable onPress={() => router.push('/safety')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><View style={styles.icon}><HugeiconsIcon icon={Shield01Icon} size={25} color={navy} /></View><View style={styles.cardText}><Text style={styles.cardTitle}>Safety and support</Text><Text style={styles.cardCopy}>Emergency contacts and help</Text></View><HugeiconsIcon icon={ArrowRight01Icon} size={20} color={navy} /></Pressable>
      <Pressable onPress={() => router.push('/notifications')} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><View style={styles.icon}><HugeiconsIcon icon={Shield01Icon} size={25} color={navy} /></View><View style={styles.cardText}><Text style={styles.cardTitle}>Notifications</Text><Text style={styles.cardCopy}>Updates, delivery history, and preferences</Text></View><HugeiconsIcon icon={ArrowRight01Icon} size={20} color={navy} /></Pressable>
    </View>
    <Pressable style={styles.accountButton} onPress={() => router.push('/auth')}><Text style={styles.accountText}>Sign in or create an account</Text></Pressable>
    <View style={styles.bottom}><Text style={styles.bottomTitle}>Made for everyday life.</Text><Text style={styles.bottomCopy}>Thoughtful service, wherever life takes you.</Text></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: cream, paddingTop: 64, paddingHorizontal: 24, paddingBottom: 48 },
  header: { marginBottom: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, logo: { color: navy, fontSize: 26, fontWeight: '800', letterSpacing: -.8 }, tag: { color: '#8B7957', fontSize: 8, fontWeight: '600', letterSpacing: 0, marginTop: 2 }, profileButton: { borderWidth: 1, borderColor: '#DAD4C9', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }, profileText: { color: navy, fontWeight: '600', fontSize: 12 },
  hero: { backgroundColor: navy, borderRadius: 30, padding: 28, paddingVertical: 34, marginBottom: 40 }, eyebrow: { color: '#D6BD8B', fontSize: 11, fontWeight: '700', letterSpacing: 2 }, title: { color: 'white', fontSize: 37, fontWeight: '700', letterSpacing: -1.3, lineHeight: 43, marginTop: 18 }, copy: { color: '#DFE5EC', fontSize: 15, lineHeight: 24, marginTop: 16 },
  sectionTitle: { color: navy, fontSize: 21, fontWeight: '700', marginBottom: 16 }, cards: { gap: 12 }, card: { backgroundColor: 'white', borderRadius: 21, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#E9E5DE' }, pressed: { transform: [{ scale: .98 }], opacity: .9 }, icon: { width: 52, height: 52, borderRadius: 17, backgroundColor: '#F2EEE5', alignItems: 'center', justifyContent: 'center' }, cardText: { flex: 1 }, cardTitle: { color: navy, fontSize: 17, fontWeight: '700' }, cardCopy: { color: '#737C87', marginTop: 4, fontSize: 13 },
  notice: { backgroundColor: '#EEE8DB', padding: 14, borderRadius: 14, marginTop: 18 }, noticeText: { color: navy, fontSize: 13 }, bottom: { marginTop: 48, paddingTop: 24, borderTopWidth: 1, borderColor: '#E2DED6' }, bottomTitle: { color: navy, fontSize: 20, fontWeight: '700' }, bottomCopy: { color: '#737C87', marginTop: 6 },
  accountButton: { marginTop: 20, borderWidth: 1, borderColor: navy, borderRadius: 14, alignItems: 'center', padding: 15 }, accountText: { color: navy, fontWeight: '700' },
});
