import { Text as NativeText, StyleSheet } from 'react-native';

const fontByWeight = {
  normal: 'Outfit_400Regular',
  '400': 'Outfit_400Regular',
  '500': 'Outfit_500Medium',
  '600': 'Outfit_600SemiBold',
  '700': 'Outfit_700Bold',
  '800': 'Outfit_800ExtraBold',
};

export function AppText({ style, ...props }) {
  const weight = StyleSheet.flatten(style)?.fontWeight ?? 'normal';
  return <NativeText {...props} style={[{ fontFamily: fontByWeight[weight] ?? fontByWeight.normal }, style]} />;
}
