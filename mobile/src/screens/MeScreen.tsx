import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api }      from '../api/client';
import { useAuth }  from '../hooks/useAuth';
import { COLORS }   from '../theme';

type Goal  = { id: string; title: string; subject?: string; progress: number; deadline?: string; completed: boolean };
type Habit = { id: string; title: string; emoji: string; completions: string[]; streak: number };
type Entry = { date: string; text: string; mood: string };

const HABITS_KEY = 'sivarr_habits_mobile';
const JNL_KEY    = 'sivarr_journal_mobile';
const MOODS      = ['😊','🙂','😐','😔','😤'];
const today      = () => new Date().toISOString().split('T')[0];

async function loadHabits(): Promise<Habit[]> { try { return JSON.parse(await AsyncStorage.getItem(HABITS_KEY) ?? '[]') } catch { return [] } }
async function saveHabits(h: Habit[]) { await AsyncStorage.setItem(HABITS_KEY, JSON.stringify(h)) }
async function loadJournal(): Promise<Entry[]> { try { return JSON.parse(await AsyncStorage.getItem(JNL_KEY) ?? '[]') } catch { return [] } }
async function saveJournal(e: Entry[]) { await AsyncStorage.setItem(JNL_KEY, JSON.stringify(e)) }

const HABIT_EMOJIS = ['📚','🏃','🧘','💧','🥗','✍️','🎯','🛌','🔔','💡','🎸','🏋️'];

export default function MeScreen() {
  const { logout }                  = useAuth();
  const [name,       setName]       = useState('');
  const [plan,       setPlan]       = useState('Free');
  const [goals,      setGoals]      = useState<Goal[]>([]);
  const [habits,     setHabits]     = useState<Habit[]>([]);
  const [journal,    setJournal]    = useState<Entry[]>([]);
  const [journalTxt, setJTxt]       = useState('');
  const [mood,       setMood]       = useState('😊');
  const [loading,    setLoading]    = useState(true);
  const [habModal,   setHabModal]   = useState(false);
  const [habTitle,   setHabTitle]   = useState('');
  const [habEmoji,   setHabEmoji]   = useState('📚');
  const [goalModal,  setGoalModal]  = useState(false);
  const [goalTitle,  setGoalTitle]  = useState('');
  const [goalDL,     setGoalDL]     = useState('');

  const todayStr = today();

  const load = useCallback(async () => {
    setLoading(true);
    const [h, j] = await Promise.all([loadHabits(), loadJournal()]);
    setHabits(h); setJournal(j);
    // Pre-fill today's journal entry if exists
    const todayEntry = j.find(e => e.date === todayStr);
    if (todayEntry) { setJTxt(todayEntry.text); setMood(todayEntry.mood); }
    // Load user profile + goals from server
    try {
      const [profileData, goalsData, billingData] = await Promise.all([
        SecureStore.getItemAsync('sivarr_name').catch(() => ''),
        api.goals().catch(() => ({ goals: [] })),
        api.billingStatus().catch(() => ({ name: 'Free' })),
      ]);
      if (profileData) setName(profileData);
      setGoals(goalsData.goals ?? []);
      setPlan(billingData.name ?? 'Free');
    } catch(_) {}
    setLoading(false);
  }, [todayStr]);

  useEffect(() => { load(); }, [load]);

  // Habit actions
  async function addHabit() {
    if (!habTitle.trim()) return;
    const h: Habit = { id: Date.now().toString(), title: habTitle.trim(), emoji: habEmoji, completions: [], streak: 0 };
    const updated  = [h, ...habits];
    setHabits(updated); await saveHabits(updated);
    setHabModal(false); setHabTitle(''); setHabEmoji('📚');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function deleteHabit(id: string) {
    Alert.alert('Delete habit?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const updated = habits.filter(h => h.id !== id);
        setHabits(updated); await saveHabits(updated);
      }},
    ]);
  }

  // Goal actions
  async function addGoal() {
    if (!goalTitle.trim()) return;
    try {
      await api.addGoal({ title: goalTitle.trim(), deadline: goalDL.trim() });
      setGoalModal(false); setGoalTitle(''); setGoalDL('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const d = await api.goals();
      setGoals(d.goals ?? []);
    } catch(_) { Alert.alert('Error', 'Could not save goal'); }
  }

  async function updateGoalProgress(id: string, current: number) {
    const pct = Math.min(100, current + 10);
    await api.updateGoal(id, pct, pct >= 100).catch(() => {});
    setGoals(prev => prev.map(g => g.id === id ? { ...g, progress: pct, completed: pct >= 100 } : g));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  // Journal
  async function saveEntry() {
    if (!journalTxt.trim()) return;
    const entry: Entry = { date: todayStr, text: journalTxt.trim(), mood };
    const updated = [entry, ...journal.filter(e => e.date !== todayStr)];
    setJournal(updated); await saveJournal(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function confirmLogout() {
    Alert.alert('Sign out?', 'You\'ll need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: logout },
    ]);
  }

  const activeGoals    = goals.filter(g => !g.completed);
  const completedGoals = goals.filter(g => g.completed);
  const streakHabits   = habits.filter(h => h.streak > 0);
  const maxStreak      = streakHabits.length ? Math.max(...streakHabits.map(h => h.streak)) : 0;
  const doneToday      = habits.filter(h => h.completions.includes(todayStr)).length;
  const initials       = name ? name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?';

  if (loading) return (
    <SafeAreaView style={s.root}><ActivityIndicator color={COLORS.accent} style={{ marginTop: 80 }} /></SafeAreaView>
  );

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Profile header */}
        <View style={s.profile}>
          <View style={s.avatar}><Text style={s.avatarTxt}>{initials}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{name || 'My profile'}</Text>
            <View style={[s.planBadge, plan !== 'Free' && s.planBadgePro]}>
              <Text style={[s.planTxt, plan !== 'Free' && s.planTxtPro]}>
                {plan !== 'Free' ? `⚡ ${plan}` : '✦ Free plan'}
              </Text>
            </View>
          </View>
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={s.statVal}>{maxStreak}</Text>
            <Text style={s.statLbl}>Best streak</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statVal}>{doneToday}/{habits.length}</Text>
            <Text style={s.statLbl}>Done today</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statVal}>{activeGoals.length}</Text>
            <Text style={s.statLbl}>Active goals</Text>
          </View>
        </View>

        {/* ── HABITS ──────────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Habits</Text>
            <TouchableOpacity style={s.addSmBtn} onPress={() => setHabModal(true)}>
              <Ionicons name="add" size={14} color={COLORS.accent} />
              <Text style={s.addSmTxt}>Add</Text>
            </TouchableOpacity>
          </View>

          {!habits.length && (
            <TouchableOpacity style={s.emptyRow} onPress={() => setHabModal(true)}>
              <Ionicons name="flame-outline" size={18} color={COLORS.muted} />
              <Text style={s.emptyTxt}>No habits yet — add one to start building consistency</Text>
            </TouchableOpacity>
          )}

          {habits.map(h => {
            const done = h.completions.includes(todayStr);
            return (
              <View key={h.id} style={s.habitRow}>
                <View style={[s.habitEmoji, done && s.habitEmojiDone]}>
                  <Text style={{ fontSize: 18 }}>{h.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.habitTitle}>{h.title}</Text>
                  <Text style={s.habitStreak}>🔥 {h.streak} day streak</Text>
                </View>
                <View style={[s.habitCheck, done && s.habitCheckDone]}>
                  {done && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
                <TouchableOpacity style={s.habitDelete} onPress={() => deleteHabit(h.id)}>
                  <Ionicons name="trash-outline" size={15} color={COLORS.muted} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* ── GOALS ───────────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Goals</Text>
            <TouchableOpacity style={s.addSmBtn} onPress={() => setGoalModal(true)}>
              <Ionicons name="add" size={14} color={COLORS.accent} />
              <Text style={s.addSmTxt}>Add</Text>
            </TouchableOpacity>
          </View>

          {!activeGoals.length && (
            <TouchableOpacity style={s.emptyRow} onPress={() => setGoalModal(true)}>
              <Ionicons name="trophy-outline" size={18} color={COLORS.muted} />
              <Text style={s.emptyTxt}>No active goals — set one to track your progress</Text>
            </TouchableOpacity>
          )}

          {activeGoals.map(g => {
            const days = g.deadline
              ? Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000)
              : null;
            return (
              <View key={g.id} style={s.goalCard}>
                <View style={s.goalTop}>
                  <Text style={s.goalTitle} numberOfLines={1}>{g.title}</Text>
                  {days !== null && (
                    <Text style={[s.goalDays, days <= 3 && { color: COLORS.red }]}>
                      {days <= 0 ? 'Due!' : `${days}d left`}
                    </Text>
                  )}
                </View>
                <View style={s.goalBar}><View style={[s.goalFill, { width: `${g.progress}%` as any }]} /></View>
                <View style={s.goalBottom}>
                  <Text style={s.goalPct}>{g.progress}%</Text>
                  <TouchableOpacity style={s.goalUpdateBtn} onPress={() => updateGoalProgress(g.id, g.progress)}>
                    <Text style={s.goalUpdateTxt}>+10%</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {completedGoals.length > 0 && (
            <Text style={s.completedNote}>{completedGoals.length} goal{completedGoals.length > 1 ? 's' : ''} completed ✓</Text>
          )}
        </View>

        {/* ── JOURNAL ─────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Journal</Text>
          <View style={s.journalCard}>
            <Text style={s.journalDate}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
            </Text>
            {/* Mood */}
            <View style={s.moodRow}>
              {MOODS.map(m => (
                <TouchableOpacity key={m} style={[s.moodBtn, mood === m && s.moodBtnSel]} onPress={() => setMood(m)}>
                  <Text style={s.moodEmoji}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={s.journalInput}
              placeholder="How was your day? What are you grateful for?"
              placeholderTextColor={COLORS.muted}
              value={journalTxt}
              onChangeText={setJTxt}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[s.saveJournalBtn, !journalTxt.trim() && s.saveJournalOff]}
              onPress={saveEntry}
              disabled={!journalTxt.trim()}
            >
              <Text style={s.saveJournalTxt}>Save entry</Text>
            </TouchableOpacity>
          </View>

          {/* Past entries */}
          {journal.filter(e => e.date !== todayStr).slice(0, 3).map(e => (
            <View key={e.date} style={s.entryCard}>
              <View style={s.entryHead}>
                <Text style={s.entryDate}>{e.date}</Text>
                <Text style={{ fontSize: 18 }}>{e.mood}</Text>
              </View>
              <Text style={s.entryText} numberOfLines={2}>{e.text}</Text>
            </View>
          ))}
        </View>

        {/* ── SETTINGS ────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Account</Text>
          {plan === 'Free' && (
            <View style={s.upgradeCard}>
              <Text style={s.upgradeTxt}>⚡ Upgrade to Pro</Text>
              <Text style={s.upgradeSub}>Unlimited AI · Org Space · Priority support</Text>
              <Text style={s.upgradePrice}>₦2,500/month</Text>
            </View>
          )}
          <TouchableOpacity style={s.settingRow} onPress={confirmLogout}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.red} />
            <Text style={[s.settingTxt, { color: COLORS.red }]}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add Habit Modal */}
      <Modal visible={habModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>New Habit</Text>
            <TextInput style={s.modalInput} placeholder="e.g. Morning study, Exercise" placeholderTextColor={COLORS.muted}
              value={habTitle} onChangeText={setHabTitle} autoFocus />
            <View style={s.emojiGrid}>
              {HABIT_EMOJIS.map(e => (
                <TouchableOpacity key={e} style={[s.emojiBtn, habEmoji === e && s.emojiBtnSel]} onPress={() => setHabEmoji(e)}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setHabModal(false)}><Text style={s.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={addHabit}><Text style={s.saveTxt}>Add Habit</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Goal Modal */}
      <Modal visible={goalModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>New Goal</Text>
            <TextInput style={s.modalInput} placeholder="e.g. Score 80% in Physics" placeholderTextColor={COLORS.muted}
              value={goalTitle} onChangeText={setGoalTitle} autoFocus />
            <TextInput style={s.modalInput} placeholder="Deadline (YYYY-MM-DD)" placeholderTextColor={COLORS.muted}
              value={goalDL} onChangeText={setGoalDL} />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setGoalModal(false)}><Text style={s.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={addGoal}><Text style={s.saveTxt}>Save Goal</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: COLORS.bg },
  scroll:          { padding: 20, paddingTop: 12, gap: 0 },

  // Profile
  profile:         { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  avatar:          { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:       { fontWeight: '800', fontSize: 20, color: '#fff' },
  profileName:     { fontWeight: '800', fontSize: 18, color: COLORS.text1, letterSpacing: -0.4 },
  planBadge:       { alignSelf: 'flex-start', backgroundColor: COLORS.bg3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4, borderWidth: 1, borderColor: COLORS.border },
  planBadgePro:    { backgroundColor: COLORS.accent + '18', borderColor: COLORS.accent + '40' },
  planTxt:         { fontSize: 11, fontWeight: '700', color: COLORS.muted },
  planTxtPro:      { color: COLORS.accent },

  // Stats
  statsRow:        { flexDirection: 'row', backgroundColor: COLORS.bg3, borderRadius: 16, padding: 16, marginBottom: 28, borderWidth: 1, borderColor: COLORS.border },
  stat:            { flex: 1, alignItems: 'center' },
  statVal:         { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5 },
  statLbl:         { fontSize: 11, color: COLORS.muted, marginTop: 3, textAlign: 'center' },
  statDivider:     { width: 1, backgroundColor: COLORS.border, marginVertical: 4 },

  // Section
  section:         { marginBottom: 28 },
  sectionHead:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle:    { fontWeight: '700', fontSize: 13, color: COLORS.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 12 },
  addSmBtn:        { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addSmTxt:        { fontSize: 13, fontWeight: '600', color: COLORS.accent },
  emptyRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  emptyTxt:        { fontSize: 13, color: COLORS.muted, flex: 1, lineHeight: 19 },

  // Habits
  habitRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: COLORS.border + '50' },
  habitEmoji:      { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.bg3, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  habitEmojiDone:  { backgroundColor: COLORS.accent + '15', borderColor: COLORS.accent + '50' },
  habitTitle:      { fontWeight: '600', fontSize: 14, color: COLORS.text1 },
  habitStreak:     { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  habitCheck:      { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  habitCheckDone:  { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  habitDelete:     { padding: 4 },

  // Goals
  goalCard:        { backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  goalTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  goalTitle:       { flex: 1, fontWeight: '700', fontSize: 14, color: COLORS.text1 },
  goalDays:        { fontSize: 12, fontWeight: '700', color: COLORS.muted, marginLeft: 8 },
  goalBar:         { height: 5, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  goalFill:        { height: '100%', backgroundColor: COLORS.accent, borderRadius: 3 },
  goalBottom:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalPct:         { fontSize: 12, color: COLORS.muted },
  goalUpdateBtn:   { backgroundColor: COLORS.accent + '20', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  goalUpdateTxt:   { fontSize: 12, fontWeight: '700', color: COLORS.accent },
  completedNote:   { fontSize: 12, color: COLORS.muted, textAlign: 'center', marginTop: 4 },

  // Journal
  journalCard:     { backgroundColor: COLORS.bg3, borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border, gap: 12 },
  journalDate:     { fontSize: 12, fontWeight: '600', color: COLORS.muted, letterSpacing: 0.3 },
  moodRow:         { flexDirection: 'row', gap: 8 },
  moodBtn:         { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  moodBtnSel:      { borderColor: COLORS.accent, backgroundColor: COLORS.accent + '20' },
  moodEmoji:       { fontSize: 20 },
  journalInput:    { color: COLORS.text1, fontSize: 14, lineHeight: 21, minHeight: 90, backgroundColor: COLORS.bg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  saveJournalBtn:  { backgroundColor: COLORS.accent, borderRadius: 10, padding: 12, alignItems: 'center' },
  saveJournalOff:  { backgroundColor: COLORS.muted },
  saveJournalTxt:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  entryCard:       { backgroundColor: COLORS.bg3, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  entryHead:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  entryDate:       { fontSize: 12, fontWeight: '700', color: COLORS.muted },
  entryText:       { fontSize: 13, color: COLORS.text2, lineHeight: 19 },

  // Settings
  upgradeCard:     { backgroundColor: '#f59e0b18', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#f59e0b40', marginBottom: 12 },
  upgradeTxt:      { fontWeight: '800', fontSize: 15, color: '#f59e0b', marginBottom: 4 },
  upgradeSub:      { fontSize: 13, color: COLORS.text2, lineHeight: 19, marginBottom: 8 },
  upgradePrice:    { fontWeight: '700', fontSize: 16, color: '#f59e0b' },
  settingRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderColor: COLORS.border },
  settingTxt:      { fontSize: 15, fontWeight: '600', color: COLORS.text2 },

  // Modals
  modalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,.7)', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: COLORS.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  modalTitle:      { fontWeight: '800', fontSize: 18, color: COLORS.text1, marginBottom: 4 },
  modalInput:      { backgroundColor: COLORS.bg3, borderRadius: 12, padding: 12, color: COLORS.text1, fontSize: 15, borderWidth: 1, borderColor: COLORS.border },
  emojiGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiBtn:        { width: 44, height: 44, borderRadius: 10, backgroundColor: COLORS.bg3, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  emojiBtnSel:     { borderColor: COLORS.accent, backgroundColor: COLORS.accent + '20' },
  modalActions:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:       { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 13, alignItems: 'center' },
  cancelTxt:       { color: COLORS.muted, fontWeight: '600', fontSize: 14 },
  saveBtn:         { flex: 1, backgroundColor: COLORS.accent, borderRadius: 12, padding: 13, alignItems: 'center' },
  saveTxt:         { color: '#fff', fontWeight: '700', fontSize: 14 },
});
