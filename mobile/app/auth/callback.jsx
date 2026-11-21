import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AppText as Text } from '../../src/AppText';
import { isConfigured, supabase } from '../../src/supabase';

const navy = '#172F4E';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams();
  const handled = useRef(false);
  const [message, setMessage] = useState('Finishing your secure sign-in…');

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    async function finish() {
      if (!isConfigured) { setMessage('MoVara account services are not configured on this device.'); return; }
      const error = params.error_description || params.error;
      if (error) { setMessage(String(error)); return; }
      const code = Array.isArray(params.code) ? params.code[0] : params.code;
      const accessToken = Array.isArray(params.access_token) ? params.access_token[0] : params.access_token;
      const refreshToken = Array.isArray(params.refresh_token) ? params.refresh_token[0] : params.refresh_token;
      const result = code
        ? await supabase.auth.exchangeCodeForSession(String(code))
        : accessToken && refreshToken
          ? await supabase.auth.setSession({ access_token: String(accessToken), refresh_token: String(refreshToken) })
          : { error: new Error('The confirmation link is incomplete. Request a new sign-in or confirmation email.') };
      if (result.error) { setMessage(result.error.message || 'We could not finish signing you in. Please try again.'); return; }
      router.replace('/');
    }
    finish().catch((error) => setMessage(error?.message || 'We could not finish signing you in. Please try again.'));
  }, [params]);

  return <View style={styles.page}><View style={styles.card}><ActivityIndicator color={navy} /><Text style={styles.brand}>MoVara</Text><Text style={styles.message}>{message}</Text>{message !== 'Finishing your secure sign-in…' && <Pressable style={styles.button} onPress={() => router.replace('/auth')}><Text style={styles.buttonText}>Return to sign in</Text></Pressable>}</View></View>;
}

const styles = StyleSheet.create({ page:{flex:1,backgroundColor:'#F6F3ED',alignItems:'center',justifyContent:'center',padding:24},card:{width:'100%',maxWidth:420,alignItems:'center',gap:14,backgroundColor:'white',borderRadius:22,padding:28,borderWidth:1,borderColor:'#E8E3DB'},brand:{color:navy,fontSize:25,fontWeight:'800',marginTop:4},message:{color:'#727A82',fontSize:15,lineHeight:22,textAlign:'center'},button:{backgroundColor:navy,borderRadius:12,paddingVertical:14,paddingHorizontal:20,marginTop:8},buttonText:{color:'white',fontWeight:'700'} });
