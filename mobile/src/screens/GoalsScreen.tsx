import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, RefreshControl, Modal, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { api }    from '../api/client';
import { COLORS } from '../theme';

type Goal = {
  id: string; title: string; subject: string;
  target_score: number; deadline: string;
  progress: number; completed: boolean;
};

export default function GoalsScreen() {
  const [goals,      setGoals]   = useState<Goal[]>([]);
  const [loading,    setLoad]    = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [modal,      setModal]   = useState(false);
  const [title,      setTitle]   = useState('');
  const [subject,    setSubject] = useState('');
  const [deadline,   setDL]      = useState('');
  const [saving,     setSaving]  = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.goals();
      setGoals(d.goals ?? []);
    } catch(_) {}
    finally { setLoad(false); setRefresh(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addGoal() {
    if (!title.trim()) { Alert.alert('Enter a goal title'); return; }
    setSaving(true);
    try {
      await api.addGoal({ title: title.trim(), subject: subject.trim(), deadline: deadline.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModal(false); setTitle(''); setSubject(''); setDL('');
      load();
    } catch(e: any) {
      Alert.alert('Error', e.message);
    } finally { setSaving(false); }
  }

  async function updateProgress(id: string, current: number) {
    const pct = Math.min(100, Math.max(0, current + 10));
    try {
      await api.updateGoal(id, pct, pct >= 100);
      setGoals(prev => prev.map(g => g.id === id ? { ...g, progress: pct, completed: pct >= 100 } : g));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (pct >= 100) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch(_) {}
  }

  const active    = goals.filter(g => !g.completed);
  const completed = goals.filter(g => g.completed);

  if (loading) return (
    <SafeAreaView style={s.root}>
      <ActivityIndicator color={COLORS.accent} style={{ marginTop: 80 }} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.root}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefresh(true); load(); }} tintColor={COLORS.accent} />}
      >
        <View style={s.header}>
          <Text style={s.title}>Goals</Text>
          <TouchableOpacity style={s.addBtn} onPress={() => setModal(true)}>
            <Text style={s.addBtnTxt}>+ New Goal</Text>
          </TouchableOpacity>
        </View>

        {/* Summary */}
        <View style={s.summary}>
          <View style={s.summaryItem}>
            <Text style={s.summaryVal}>{active.length}</Text>
            <Text style={s.summaryLbl}>Active</Text>
          </View>
          <View style={s.summaryItem}>
            <Text style={[s.summaryVal, { color: COLORS.green }]}>{completed.length}</Text>
            <Text style={s.summaryLbl}>Done</Text>
          </View>
          <View style={s.summaryItem}>
            <Text style={s.summaryVal}>
              {active.length ? Math.round(active.reduce((a, g) => a + g.progress, 0) / active.length) : 0}%
            </Text>
            <Text style={s.summaryLbl}>Avg progress</Text>
          </View>
        </View>

        {!goals.length && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🎯</Text>
            <Text style={s.emptyTitle}>No goals yet</Text>
            <Text style={s.emptyText}>Set a goal to start tracking your progress</Text>
            <TouchableOpacity style={s.emptyCta} onPress={() => setModal(true)}>
              <Text style={s.emptyCtaTxt}>Set your first goal</Text>
            </TouchableOpacity>
          </View>
        )}

        {active.map(g => (
          <GoalCard key={g.id} goal={g} onProgressTap={() => updateProgress(g.id, g.progress)} />
        ))}

        {completed.length > 0 && (
          <>
            <Text style={s.sectionLabel}>Completed</Text>
            {completed.map(g => (
              <GoalCard key={g.id} goal={g} completed />
            ))}
          </>
        )}
      </ScrollView>

      {/* Add Goal Modal */}
      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>New Goal</Text>

            <Text style={s.fieldLabel}>Goal title *</Text>
            <TextInput style={s.input} placeholder="e.g. Score 80% in Physics" placeholderTextColor={COLORS.muted}
              value={title} onChangeText={setTitle} autoFocus />

            <Text style={s.fieldLabel}>Subject / area</Text>
            <TextInput style={s.input} placeholder="e.g. Physics, Marketing" placeholderTextColor={COLORS.muted}
              value={subject} onChangeText={setSubject} />

            <Text style={s.fieldLabel}>Deadline (YYYY-MM-DD)</Text>
            <TextInput style={s.input} placeholder="2026-12-31" placeholderTextColor={COLORS.muted}
              value={deadline} onChangeText={setDL} />

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={addGoal} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveTxt}>Save Goal</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function GoalCard({ goal, completed = false, onProgressTap }: { goal: Goal; completed?: boolean; onProgressTap?: () => void }) {
  const daysLeft = goal.deadline
    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <View style={[s.card, completed && s.cardDone]}>
      <View style={s.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[s.goalTitle, completed && s.goalTitleDone]}>{goal.title}</Text>
          {goal.subject ? <Text style={s.goalSub}>{goal.subject}</Text> : null}
        </View>
        {completed && <Text style={s.doneCheck}>✓</Text>}
        {!completed && daysLeft !== null && (
          <Text style={[s.deadline, daysLeft <= 3 && { color: COLORS.red }]}>
            {daysLeft === 0 ? 'Today' : daysLeft > 0 ? `${daysLeft}d left` : `${Math.abs(daysLeft)}d over`}
          </Text>
        )}
      </View>

      {/* Progress bar */}
      <View style={s.progressRow}>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${goal.progress}%` as any }]} />
        </View>
        <Text style={s.progressPct}>{goal.progress}%</Text>
      </View>

      {!completed && onProgressTap && (
        <TouchableOpacity style={s.progressBtn} onPress={onProgressTap}>
          <Text style={s.progressBtnTxt}>+10% progress</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: COLORS.bg },
  content:       { padding: 16, gap: 10 },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title:         { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5 },
  addBtn:        { backgroundColor: COLORS.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnTxt:     { color: '#fff', fontWeight: '700', fontSize: 13 },
  summary:       { flexDirection: 'row', backgroundColor: COLORS.bg3, borderRadius: 14, padding: 16, gap: 0, marginBottom: 4, borderWidth: 1, borderColor: COLORS.border },
  summaryItem:   { flex: 1, alignItems: 'center' },
  summaryVal:    { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5 },
  summaryLbl:    { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  empty:         { alignItems: 'center', paddingVertical: 40 },
  emptyIcon:     { fontSize: 40, marginBottom: 12 },
  emptyTitle:    { fontWeight: '700', fontSize: 17, color: COLORS.text1, marginBottom: 6 },
  emptyText:     { fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },
  emptyCta:      { marginTop: 16, backgroundColor: COLORS.accent, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  emptyCtaTxt:   { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionLabel:  { fontSize: 11, fontWeight: '700', color: COLORS.muted, letterSpacing: 0.6, marginTop: 8, marginBottom: 2 },
  card:          { backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  cardDone:      { opacity: 0.6 },
  cardHeader:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  goalTitle:     { fontWeight: '700', fontSize: 15, color: COLORS.text1, lineHeight: 20 },
  goalTitleDone: { textDecorationLine: 'line-through', color: COLORS.muted },
  goalSub:       { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  deadline:      { fontSize: 12, fontWeight: '600', color: COLORS.muted, marginLeft: 8, flexShrink: 0 },
  doneCheck:     { fontSize: 18, color: COLORS.green, marginLeft: 8 },
  progressRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  progressTrack: { flex: 1, height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: COLORS.accent, borderRadius: 3 },
  progressPct:   { fontSize: 12, fontWeight: '700', color: COLORS.accent, width: 36, textAlign: 'right' },
  progressBtn:   { alignSelf: 'flex-start', backgroundColor: COLORS.accent + '20', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  progressBtnTxt:{ fontSize: 12, fontWeight: '600', color: COLORS.accent },
  // Modal
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,.7)', justifyContent: 'flex-end' },
  modalBox:      { backgroundColor: COLORS.bg2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 10 },
  modalTitle:    { fontWeight: '800', fontSize: 18, color: COLORS.text1, marginBottom: 4 },
  fieldLabel:    { fontSize: 12, fontWeight: '600', color: COLORS.muted, letterSpacing: 0.4 },
  input:         { backgroundColor: COLORS.bg3, borderRadius: 10, padding: 12, color: COLORS.text1, fontSize: 15, borderWidth: 1, borderColor: COLORS.border },
  modalActions:  { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:     { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 13, alignItems: 'center' },
  cancelTxt:     { color: COLORS.muted, fontWeight: '600', fontSize: 14 },
  saveBtn:       { flex: 1, backgroundColor: COLORS.accent, borderRadius: 10, padding: 13, alignItems: 'center' },
  saveTxt:       { color: '#fff', fontWeight: '700', fontSize: 14 },
});
