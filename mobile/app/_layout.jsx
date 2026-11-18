import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold } from '@expo-google-fonts/outfit';

export default function RootLayout() {
  const [ready] = useFonts({ Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold });
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#F7F5F0', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#172F4E" /></View>;
  return <><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom', contentStyle: { backgroundColor: '#F7F5F0' } }} /></>;
}
