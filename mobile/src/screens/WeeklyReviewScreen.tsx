import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { COLORS } from '../theme';

const TASKS_KEY  = 'sivarr_tasks_mobile';
const HABITS_KEY = 'sivarr_habits_mobile';
const JNL_KEY    = 'sivarr_journal_mobile';

const today   = () => new Date().toISOString().split('T')[0];
const weekAgo = () => new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0];

type Stat = { label: string; value: string; icon: string };

export default function WeeklyReviewScreen() {
  const [loading,  setLoading]  = useState(false);
  const [review,   setReview]   = useState('');
  const [week,     setWeek]     = useState('');
  const [stats,    setStats]    = useState<Stat[]>([]);
  const [generated, setGenerated] = useState(false);

  const buildStats = useCallback(async (): Promise<Stat[]> => {
    const wa = weekAgo();
    const results: Stat[] = [];

    try {
      const tasks    = JSON.parse(await AsyncStorage.getItem(TASKS_KEY) ?? '[]');
      const done     = tasks.filter((t: any) => t.done).length;
      results.push({ label: 'Tasks done', value: `${done}/${tasks.length}`, icon: 'checkbox-outline' });
    } catch { results.push({ label: 'Tasks done', value: '—', icon: 'checkbox-outline' }); }

    try {
      const habits = JSON.parse(await AsyncStorage.getItem(HABITS_KEY) ?? '[]');
      if (habits.length) {
        const days: string[] = [];
        for (let i = 0; i < 7; i++) {
          days.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0]);
        }
        let completed = 0;
        const possible = habits.length * 7;
        habits.forEach((h: any) => {
          (h.completions ?? []).forEach((d: string) => { if (days.includes(d)) completed++; });
        });
        const pct = possible ? Math.round(completed / possible * 100) : 0;
        results.push({ label: 'Habits rate', value: `${pct}%`, icon: 'flame-outline' });
      } else {
        results.push({ label: 'Habits rate', value: '—', icon: 'flame-outline' });
      }
    } catch { results.push({ label: 'Habits rate', value: '—', icon: 'flame-outline' }); }

    try {
      const entries = JSON.parse(await AsyncStorage.getItem(JNL_KEY) ?? '[]');
      const thisWeek = entries.filter((e: any) => e.date && e.date >= wa).length;
      results.push({ label: 'Journal entries', value: String(thisWeek), icon: 'journal-outline' });
    } catch { results.push({ label: 'Journal entries', value: '—', icon: 'journal-outline' }); }

    return results;
  }, []);

  useEffect(() => {
    buildStats().then(setStats);
  }, [buildStats]);

  async function generate() {
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const tasks    = JSON.parse(await AsyncStorage.getItem(TASKS_KEY) ?? '[]');
      const habits   = JSON.parse(await AsyncStorage.getItem(HABITS_KEY) ?? '[]');
      const journal  = JSON.parse(await AsyncStorage.getItem(JNL_KEY) ?? '[]');

      const tasksDone  = tasks.filter((t: any) => t.done).length;
      const tasksTotal = tasks.length;
      const wa         = weekAgo();

      let habitsPct = 0;
      if (habits.length) {
        const days: string[] = [];
        for (let i = 0; i < 7; i++) days.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0]);
        let completed = 0;
        habits.forEach((h: any) => { (h.completions ?? []).forEach((d: string) => { if (days.includes(d)) completed++; }); });
        habitsPct = habits.length * 7 ? Math.round(completed / (habits.length * 7) * 100) : 0;
      }

      const mood = journal.length ? (journal[journal.length - 1]?.mood ?? '') : '';

      const res = await api.weeklyReview({ tasks_done: tasksDone, tasks_total: tasksTotal, habits_pct: habitsPct, mood, goals: [] });
      setReview(res.review ?? '');
      setWeek(res.week ?? '');
      setGenerated(true);
      const refreshed = await buildStats();
      setStats(refreshed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Error', 'Could not generate review. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Weekly Review</Text>
          <Text style={s.sub}>Reflect · Plan · Improve</Text>
        </View>
        <TouchableOpacity
          style={[s.genBtn, loading && s.genBtnOff]}
          onPress={generate}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Ionicons name="sparkles" size={14} color="#fff" /><Text style={s.genBtnTxt}> Generate</Text></>
          }
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Stats row */}
        <View style={s.statsRow}>
          {stats.map(st => (
            <View key={st.label} style={s.statCard}>
              <Ionicons name={st.icon as any} size={18} color={COLORS.accent} style={{ marginBottom: 6 }} />
              <Text style={s.statVal}>{st.value}</Text>
              <Text style={s.statLbl}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* AI Review */}
        {generated && review ? (
          <View style={s.reviewCard}>
            <View style={s.reviewHeader}>
              <View style={s.reviewOrb}>
                <Text style={{ fontSize: 14 }}>✦</Text>
              </View>
              <View>
                <Text style={s.reviewTitle}>SIVA's Review</Text>
                {week ? <Text style={s.reviewWeek}>{week}</Text> : null}
              </View>
            </View>
            <Text style={s.reviewText}>{review}</Text>
          </View>
        ) : !loading ? (
          <View style={s.emptyState}>
            <View style={s.emptyOrb}>
              <Ionicons name="calendar-outline" size={28} color={COLORS.accent} />
            </View>
            <Text style={s.emptyTitle}>Your week, reflected</Text>
            <Text style={s.emptySub}>
              SIVA reads your tasks, habits, and journal entries — then writes a personalised review to close out your week and sharpen your next.
            </Text>
            <TouchableOpacity style={s.emptyCta} onPress={generate} activeOpacity={0.85}>
              <Ionicons name="sparkles-outline" size={15} color="#fff" />
              <Text style={s.emptyCtaTxt}>Generate my review</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: COLORS.bg },

  // Header
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 12 },
  title:       { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5 },
  sub:         { fontSize: 12, color: COLORS.muted, marginTop: 2, fontWeight: '500' },
  genBtn:      { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  genBtnOff:   { opacity: 0.6 },
  genBtnTxt:   { color: '#fff', fontWeight: '700', fontSize: 13 },

  scroll:      { padding: 20, paddingTop: 4, gap: 16 },

  // Stats
  statsRow:    { flexDirection: 'row', gap: 10 },
  statCard:    { flex: 1, backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  statVal:     { fontWeight: '800', fontSize: 18, color: COLORS.text1, letterSpacing: -0.4 },
  statLbl:     { fontSize: 10, color: COLORS.muted, marginTop: 3, textAlign: 'center', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },

  // Review card
  reviewCard:  { backgroundColor: COLORS.bg3, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.border },
  reviewHeader:{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  reviewOrb:   { width: 40, height: 40, borderRadius: 14, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  reviewTitle: { fontWeight: '800', fontSize: 15, color: COLORS.text1 },
  reviewWeek:  { fontSize: 12, color: COLORS.muted, marginTop: 2, fontWeight: '500' },
  reviewText:  { fontSize: 14, color: COLORS.text2, lineHeight: 23 },

  // Empty state
  emptyState:  { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16, gap: 12 },
  emptyOrb:    { width: 64, height: 64, borderRadius: 22, backgroundColor: COLORS.accent + '20', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle:  { fontWeight: '800', fontSize: 18, color: COLORS.text1, textAlign: 'center' },
  emptySub:    { fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  emptyCta:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.accent, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyCtaTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
