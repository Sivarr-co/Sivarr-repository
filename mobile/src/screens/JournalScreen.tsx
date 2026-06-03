import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../theme';

type Entry = { date: string; text: string; mood: string; ts: number };

const JNL_KEY = 'sivarr_journal_mobile';

async function loadEntries(): Promise<Entry[]> {
  try { return JSON.parse((await AsyncStorage.getItem(JNL_KEY)) ?? '[]'); }
  catch { return []; }
}
async function saveEntries(entries: Entry[]) {
  await AsyncStorage.setItem(JNL_KEY, JSON.stringify(entries));
}

const MOODS = ['😊','🙂','😐','😔','😤'];
const today = () => new Date().toISOString().split('T')[0];

export default function JournalScreen() {
  const [entries,  setEntries] = useState<Entry[]>([]);
  const [text,     setText]    = useState('');
  const [mood,     setMood]    = useState('😊');
  const [saved,    setSaved]   = useState(false);
  const [view,     setView]    = useState<'write' | 'history'>('write');

  const todayStr = today();

  const load = useCallback(async () => {
    const all = await loadEntries();
    setEntries(all);
    const existing = all.find(e => e.date === todayStr);
    if (existing) { setText(existing.text); setMood(existing.mood); setSaved(true); }
  }, [todayStr]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!text.trim()) return;
    const entry: Entry = { date: todayStr, text: text.trim(), mood, ts: Date.now() };
    const updated = [entry, ...entries.filter(e => e.date !== todayStr)];
    setEntries(updated);
    await saveEntries(updated);
    setSaved(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  })();

  return (
    <SafeAreaView style={s.root}>
      {/* Tab switcher */}
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, view === 'write' && s.tabActive]} onPress={() => setView('write')}>
          <Text style={[s.tabTxt, view === 'write' && s.tabTxtActive]}>Today</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, view === 'history' && s.tabActive]} onPress={() => setView('history')}>
          <Text style={[s.tabTxt, view === 'history' && s.tabTxtActive]}>Past entries</Text>
        </TouchableOpacity>
      </View>

      {view === 'write' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.writeContent}>
            <Text style={s.dateLabel}>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
            <Text style={s.prompt}>Good {greeting}. What's on your mind?</Text>

            {/* Mood picker */}
            <View style={s.moodRow}>
              <Text style={s.moodLabel}>How are you feeling?</Text>
              <View style={s.moodPicker}>
                {MOODS.map(m => (
                  <TouchableOpacity key={m} style={[s.moodBtn, mood === m && s.moodBtnSel]} onPress={() => setMood(m)}>
                    <Text style={s.moodEmoji}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Text input */}
            <TextInput
              style={s.textArea}
              placeholder="Write your thoughts, reflections, or what you're grateful for today…"
              placeholderTextColor={COLORS.muted}
              value={text}
              onChangeText={t => { setText(t); setSaved(false); }}
              multiline
              textAlignVertical="top"
              autoCorrect
            />

            <TouchableOpacity style={[s.saveBtn, !text.trim() && s.saveBtnDisabled]} onPress={save} disabled={!text.trim()}>
              <Text style={s.saveTxt}>{saved ? '✓ Saved' : 'Save entry'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <ScrollView contentContainerStyle={s.historyContent}>
          {entries.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>📓</Text>
              <Text style={s.emptyTitle}>No entries yet</Text>
              <Text style={s.emptyText}>Start writing to build your journal</Text>
            </View>
          )}
          {entries.map(e => (
            <View key={e.date} style={s.entryCard}>
              <View style={s.entryHeader}>
                <Text style={s.entryDate}>{e.date}</Text>
                <Text style={s.entryMood}>{e.mood}</Text>
              </View>
              <Text style={s.entryText} numberOfLines={4}>{e.text}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: COLORS.bg },
  tabs:           { flexDirection: 'row', padding: 12, gap: 8, borderBottomWidth: 1, borderColor: COLORS.border },
  tab:            { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive:      { backgroundColor: COLORS.accent + '20' },
  tabTxt:         { fontSize: 14, fontWeight: '600', color: COLORS.muted },
  tabTxtActive:   { color: COLORS.accent },
  // Write view
  writeContent:   { padding: 20, gap: 16, paddingBottom: 40 },
  dateLabel:      { fontSize: 12, fontWeight: '600', color: COLORS.muted, letterSpacing: 0.4 },
  prompt:         { fontWeight: '800', fontSize: 20, color: COLORS.text1, letterSpacing: -0.3, lineHeight: 26 },
  moodRow:        { gap: 8 },
  moodLabel:      { fontSize: 13, color: COLORS.muted, fontWeight: '600' },
  moodPicker:     { flexDirection: 'row', gap: 8 },
  moodBtn:        { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.bg3, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  moodBtnSel:     { borderColor: COLORS.accent, backgroundColor: COLORS.accent + '20' },
  moodEmoji:      { fontSize: 22 },
  textArea:       { backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, color: COLORS.text1, fontSize: 15, lineHeight: 22, minHeight: 180, borderWidth: 1, borderColor: COLORS.border },
  saveBtn:        { backgroundColor: COLORS.accent, borderRadius: 12, padding: 14, alignItems: 'center' },
  saveBtnDisabled:{ backgroundColor: COLORS.muted },
  saveTxt:        { color: '#fff', fontWeight: '700', fontSize: 15 },
  // History view
  historyContent: { padding: 16, gap: 10 },
  empty:          { alignItems: 'center', paddingVertical: 60 },
  emptyIcon:      { fontSize: 40, marginBottom: 12 },
  emptyTitle:     { fontWeight: '700', fontSize: 17, color: COLORS.text1, marginBottom: 6 },
  emptyText:      { fontSize: 14, color: COLORS.muted },
  entryCard:      { backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  entryHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  entryDate:      { fontSize: 13, fontWeight: '700', color: COLORS.text1 },
  entryMood:      { fontSize: 20 },
  entryText:      { fontSize: 14, color: COLORS.text2, lineHeight: 20 },
});
