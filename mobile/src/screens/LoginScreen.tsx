import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { api }            from '../api/client';
import { useAuth }        from '../hooks/useAuth';
import { COLORS }         from '../theme';

export default function LoginScreen() {
  const { login }             = useAuth();
  const [email,    setEmail]  = useState('');
  const [password, setPass]   = useState('');
  const [loading,  setLoad]   = useState(false);
  const [isReg,    setIsReg]  = useState(false);
  const [name,     setName]   = useState('');

  async function submit() {
    if (!email.trim() || !password.trim()) { Alert.alert('Fill in all fields'); return; }
    setLoad(true);
    try {
      const d = isReg
        ? await api.register(name.trim(), email.trim(), password)
        : await api.login(email.trim(), password);
      if (d.token) {
        await login(d.token);
      } else {
        Alert.alert('Error', d.detail ?? 'Login failed');
      }
    } catch(e: any) {
      Alert.alert('Error', e.message ?? 'Something went wrong');
    } finally { setLoad(false); }
  }

  return (
    <LinearGradient colors={['#0a0a0a','#111827']} style={s.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.inner}>
        <Text style={s.logo}>SIVARR</Text>
        <Text style={s.tagline}>Your Productivity OS</Text>

        {isReg && (
          <TextInput style={s.input} placeholder="Full name" placeholderTextColor={COLORS.muted}
            value={name} onChangeText={setName} autoCapitalize="words" />
        )}
        <TextInput style={s.input} placeholder="Email" placeholderTextColor={COLORS.muted}
          value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <TextInput style={s.input} placeholder="Password" placeholderTextColor={COLORS.muted}
          value={password} onChangeText={setPass} secureTextEntry />

        <TouchableOpacity style={s.btn} onPress={submit} disabled={loading} activeOpacity={0.85}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnTxt}>{isReg ? 'Create account' : 'Sign in'}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsReg(!isReg)} style={{ marginTop: 16 }}>
          <Text style={s.toggle}>
            {isReg ? 'Already have an account? Sign in' : "Don't have an account? Register"}
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1 },
  inner:   { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo:    { fontWeight: '900', fontSize: 34, color: COLORS.text1, letterSpacing: -1, marginBottom: 4 },
  tagline: { fontSize: 14, color: COLORS.muted, marginBottom: 40 },
  input:   { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16,
             paddingVertical: 14, color: COLORS.text1, fontSize: 15, marginBottom: 12, backgroundColor: COLORS.bg3 },
  btn:     { backgroundColor: COLORS.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  btnTxt:  { color: '#fff', fontWeight: '800', fontSize: 16 },
  toggle:  { color: COLORS.muted, textAlign: 'center', fontSize: 13 },
});
