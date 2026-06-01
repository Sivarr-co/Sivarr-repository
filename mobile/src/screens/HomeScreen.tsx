import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api }    from '../api/client';
import { COLORS } from '../theme';

export default function HomeScreen() {
  const [brief,     setBrief]     = useState('Loading your brief…');
  const [refreshing, setRefresh]  = useState(false);
  const [greeting,  setGreeting]  = useState('');

  useEffect(() => { init(); }, []);

  async function init() {
    const hr = new Date().getHours();
    setGreeting(hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening');
    loadBrief();
  }

  async function loadBrief() {
    try {
      const d = await api.homeBrief({ open_tasks: 0, streak: 0 });
      if (d.brief) setBrief(d.brief);
    } catch(_) { setBrief('Ready to make today count?'); }
  }

  async function onRefresh() {
    setRefresh(true);
    await loadBrief();
    setRefresh(false);
  }

  return (
    <SafeAreaView style={s.root}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}>
        <View style={s.header}>
          <Text style={s.logo}>SIVARR</Text>
        </View>

        {/* AI Brief */}
        <View style={s.briefCard}>
          <View style={s.briefTop}>
            <View style={s.briefAv}><Text style={{ fontSize: 18 }}>✦</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.briefName}>{greeting}</Text>
              <Text style={s.briefSub}>SIVARR AI · Your daily brief</Text>
            </View>
          </View>
          <Text style={s.briefMsg}>{brief}</Text>
        </View>

        {/* Quick actions */}
        <Text style={s.sectionTitle}>Quick actions</Text>
        <View style={s.pills}>
          {['Ask AI','My Tasks','Goals','Journal','Calendar'].map(label => (
            <TouchableOpacity key={label} style={s.pill}>
              <Text style={s.pillTxt}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.bg },
  header:       { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  logo:         { fontWeight: '900', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5 },
  briefCard:    { margin: 16, backgroundColor: COLORS.bg3, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  briefTop:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  briefAv:      { width: 36, height: 36, borderRadius: 18, backgroundColor: '#0D7A5F22', alignItems: 'center', justifyContent: 'center' },
  briefName:    { fontWeight: '700', fontSize: 15, color: COLORS.text1 },
  briefSub:     { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  briefMsg:     { fontSize: 14, color: COLORS.text2, lineHeight: 21 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.muted, marginLeft: 16, marginBottom: 8, letterSpacing: 0.5 },
  pills:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  pill:         { backgroundColor: COLORS.bg3, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border },
  pillTxt:      { fontSize: 13, fontWeight: '600', color: COLORS.text2 },
});
