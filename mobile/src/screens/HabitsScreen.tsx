import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../theme';

type Habit = {
  id: string; title: string; emoji: string;
  completions: string[]; streak: number;
};

const STORAGE_KEY = 'sivarr_habits_mobile';
const today = () => new Date().toISOString().split('T')[0];

async function loadHabits(): Promise<Habit[]> {
  try { return JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]'); }
  catch { return []; }
}
async function saveHabits(habits: Habit[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}

export default function HabitsScreen() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [modal,  setModal]  = useState(false);
  const [title,  setTitle]  = useState('');
  const [emoji,  setEmoji]  = useState('📚');

  const EMOJIS = ['📚','🏃','🧘','💧','🥗','✍️','🎯','🛌','🔔','💡','🎸','🏋️'];

  const load = useCallback(async () => {
    setHabits(await loadHabits());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleHabit(id: string) {
    const todayStr = today();
    const updated  = habits.map(h => {
      if (h.id !== id) return h;
      const done = h.completions.includes(todayStr);
      const completions = done
        ? h.completions.filter(d => d !== todayStr)
        : [...h.completions, todayStr];
      const streak = done ? Math.max(0, h.streak - 1) : h.streak + 1;
      return { ...h, completions, streak };
    });
    setHabits(updated);
    await saveHabits(updated);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  async function addHabit() {
    if (!title.trim()) { Alert.alert('Enter a habit name'); return; }
    const habit: Habit = {
      id: Date.now().toString(), title: title.trim(),
      emoji, completions: [], streak: 0,
    };
    const updated = [habit, ...habits];
    setHabits(updated);
    await saveHabits(updated);
    setModal(false); setTitle(''); setEmoji('📚');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function deleteHabit(id: string) {
    Alert.alert('Delete habit?', 'This can\'t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const updated = habits.filter(h => h.id !== id);
          setHabits(updated);
          await saveHabits(updated);
        },
      },
    ]);
  }

  const todayStr   = today();
  const doneToday  = habits.filter(h => h.completions.includes(todayStr)).length;

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.header}>
          <Text style={s.title}>Habits</Text>
          <TouchableOpacity style={s.addBtn} onPress={() => setModal(true)}>
            <Text style={s.addBtnTxt}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {/* Daily progress */}
        <View style={s.progressCard}>
          <Text style={s.progressLabel}>Today's check-ins</Text>
          <Text style={s.progressCount}>
            <Text style={s.progressDone}>{doneToday}</Text>
            <Text style={s.progressTotal}> / {habits.length}</Text>
          </Text>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: habits.length ? `${(doneToday / habits.length) * 100}%` as any : '0%' }]} />
          </View>
        </View>

        {!habits.length && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🔥</Text>
            <Text style={s.emptyTitle}>No habits yet</Text>
            <Text style={s.emptyText}>Build consistency by tracking daily habits</Text>
            <TouchableOpacity style={s.emptyCta} onPress={() => setModal(true)}>
              <Text style={s.emptyCtaTxt}>Add your first habit</Text>
            </TouchableOpacity>
          </View>
        )}

        {habits.map(h => {
          const doneToday = h.completions.includes(todayStr);
          return (
            <TouchableOpacity key={h.id} style={[s.card, doneToday && s.cardDone]} onPress={() => toggleHabit(h.id)} onLongPress={() => deleteHabit(h.id)} activeOpacity={0.75}>
              <View style={s.cardLeft}>
                <View style={[s.emojiWrap, doneToday && s.emojiWrapDone]}>
                  <Text style={s.emoji}>{h.emoji}</Text>
                </View>
                <View>
                  <Text style={[s.habitTitle, doneToday && s.habitTitleDone]}>{h.title}</Text>
                  <Text style={s.streakTxt}>🔥 {h.streak} day streak</Text>
                </View>
              </View>
              <View style={[s.checkWrap, doneToday && s.checkWrapDone]}>
                {doneToday && <Text style={s.checkIcon}>✓</Text>}
              </View>
            </TouchableOpacity>
          );
        })}

        <Text style={s.hint}>Long-press a habit to delete it</Text>
      </ScrollView>

      {/* Add Habit Modal */}
      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>New Habit</Text>

            <Text style={s.fieldLabel}>Habit name</Text>
            <TextInput style={s.input} placeholder="e.g. Morning study, Exercise" placeholderTextColor={COLORS.muted}
              value={title} onChangeText={setTitle} autoFocus />

            <Text style={s.fieldLabel}>Pick an emoji</Text>
            <View style={s.emojiGrid}>
              {EMOJIS.map(e => (
                <TouchableOpacity key={e} style={[s.emojiPick, emoji === e && s.emojiPickSel]} onPress={() => setEmoji(e)}>
                  <Text style={s.emojiPickTxt}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={addHabit}>
                <Text style={s.saveTxt}>Add Habit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: COLORS.bg },
  content:        { padding: 16, gap: 10, paddingBottom: 32 },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title:          { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5 },
  addBtn:         { backgroundColor: COLORS.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnTxt:      { color: '#fff', fontWeight: '700', fontSize: 13 },
  progressCard:   { backgroundColor: COLORS.bg3, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 4 },
  progressLabel:  { fontSize: 12, color: COLORS.muted, fontWeight: '600', marginBottom: 6 },
  progressCount:  { marginBottom: 8 },
  progressDone:   { fontWeight: '800', fontSize: 28, color: COLORS.accent },
  progressTotal:  { fontSize: 18, color: COLORS.muted, fontWeight: '600' },
  progressTrack:  { height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden' },
  progressFill:   { height: '100%', backgroundColor: COLORS.accent, borderRadius: 3 },
  empty:          { alignItems: 'center', paddingVertical: 40 },
  emptyIcon:      { fontSize: 40, marginBottom: 12 },
  emptyTitle:     { fontWeight: '700', fontSize: 17, color: COLORS.text1, marginBottom: 6 },
  emptyText:      { fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },
  emptyCta:       { marginTop: 16, backgroundColor: COLORS.accent, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  emptyCtaTxt:    { color: '#fff', fontWeight: '700', fontSize: 14 },
  card:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  cardDone:       { borderColor: COLORS.accent + '40', backgroundColor: COLORS.accent + '10' },
  cardLeft:       { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  emojiWrap:      { width: 42, height: 42, borderRadius: 12, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
  emojiWrapDone:  { backgroundColor: COLORS.accent + '20' },
  emoji:          { fontSize: 22 },
  habitTitle:     { fontWeight: '700', fontSize: 15, color: COLORS.text1 },
  habitTitleDone: { color: COLORS.accent },
  streakTxt:      { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  checkWrap:      { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  checkWrapDone:  { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkIcon:      { color: '#fff', fontWeight: '800', fontSize: 14 },
  hint:           { textAlign: 'center', fontSize: 11, color: COLORS.muted, marginTop: 4 },
  // Modal
  modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,.7)', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: COLORS.bg2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 12 },
  modalTitle:     { fontWeight: '800', fontSize: 18, color: COLORS.text1, marginBottom: 4 },
  fieldLabel:     { fontSize: 12, fontWeight: '600', color: COLORS.muted, letterSpacing: 0.4 },
  input:          { backgroundColor: COLORS.bg3, borderRadius: 10, padding: 12, color: COLORS.text1, fontSize: 15, borderWidth: 1, borderColor: COLORS.border },
  emojiGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiPick:      { width: 44, height: 44, borderRadius: 10, backgroundColor: COLORS.bg3, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  emojiPickSel:   { borderColor: COLORS.accent, backgroundColor: COLORS.accent + '20' },
  emojiPickTxt:   { fontSize: 22 },
  modalActions:   { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:      { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 13, alignItems: 'center' },
  cancelTxt:      { color: COLORS.muted, fontWeight: '600', fontSize: 14 },
  saveBtn:        { flex: 1, backgroundColor: COLORS.accent, borderRadius: 10, padding: 13, alignItems: 'center' },
  saveTxt:        { color: '#fff', fontWeight: '700', fontSize: 14 },
});
