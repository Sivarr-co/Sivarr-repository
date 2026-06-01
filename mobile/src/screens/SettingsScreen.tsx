import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api }    from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../theme';

export default function SettingsScreen() {
  const { logout }   = useAuth();
  const [plan,   setPlan]   = useState('Free');
  const [expires, setExp]  = useState('');
  const [history, setHist] = useState<any[]>([]);

  useEffect(() => {
    api.billingStatus().then(d => {
      setPlan(d.name ?? 'Free');
      setExp(d.expires ?? '');
    }).catch(() => {});
    api.billingHistory().then(d => setHist(d.history ?? [])).catch(() => {});
  }, []);

  function confirmLogout() {
    Alert.alert('Sign out?', 'You\'ll need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: logout },
    ]);
  }

  const isPaid = plan !== 'Free';

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>Settings</Text>

        {/* Plan card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>My Plan</Text>
          <View style={s.row}>
            <Text style={s.label}>Current plan</Text>
            <View style={[s.badge, isPaid ? s.badgePro : s.badgeFree]}>
              <Text style={[s.badgeTxt, isPaid ? s.badgeProTxt : s.badgeFreeTxt]}>
                {isPaid ? `⚡ ${plan}` : '✦ Free'}
              </Text>
            </View>
          </View>
          {isPaid && expires && (
            <View style={s.row}>
              <Text style={s.label}>Expires</Text>
              <Text style={s.value}>{expires}</Text>
            </View>
          )}
          {!isPaid && (
            <TouchableOpacity style={s.upgradeBtn}>
              <Text style={s.upgradeTxt}>⚡ Upgrade to Pro</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Billing history */}
        {history.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Payment History</Text>
            {history.map((h, i) => (
              <View key={i} style={[s.row, { paddingVertical: 10, borderBottomWidth: i < history.length-1 ? 1 : 0, borderColor: COLORS.border }]}>
                <View>
                  <Text style={s.histPlan}>{h.plan}</Text>
                  <Text style={s.histDate}>{h.date} · {h.gateway}</Text>
                </View>
                <Text style={s.histAmount}>{h.amount}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={confirmLogout}>
          <Text style={s.signOutTxt}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.bg },
  content:      { padding: 20, gap: 14 },
  title:        { fontWeight: '800', fontSize: 22, color: COLORS.text1, marginBottom: 4 },
  card:         { backgroundColor: COLORS.bg3, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardTitle:    { fontWeight: '700', fontSize: 14, color: COLORS.muted, marginBottom: 12, letterSpacing: 0.4 },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:        { fontSize: 14, color: COLORS.text2 },
  value:        { fontSize: 14, fontWeight: '600', color: COLORS.text1 },
  badge:        { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  badgeFree:    { backgroundColor: COLORS.bg },
  badgePro:     { backgroundColor: COLORS.accent + '22' },
  badgeTxt:     { fontSize: 12, fontWeight: '700' },
  badgeFreeTxt: { color: COLORS.muted },
  badgeProTxt:  { color: COLORS.accent },
  upgradeBtn:   { marginTop: 12, backgroundColor: '#f59e0b', borderRadius: 10, padding: 12, alignItems: 'center' },
  upgradeTxt:   { color: '#fff', fontWeight: '800', fontSize: 14 },
  histPlan:     { fontWeight: '600', fontSize: 13, color: COLORS.text1 },
  histDate:     { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  histAmount:   { fontWeight: '700', fontSize: 13, color: COLORS.accent },
  signOutBtn:   { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  signOutTxt:   { color: COLORS.muted, fontWeight: '600', fontSize: 14 },
});
