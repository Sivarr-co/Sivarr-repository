import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, RefreshControl, Modal, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { COLORS } from '../theme';

// Org space, v1: read + basic create/add only — no chat or live presence.
// The web app's org chat/presence is real-time (SSE + a WebSocket, see
// routes/org.py), and there's no WebSocket/SSE client anywhere in this
// mobile app yet — bringing that over is a separate, larger piece of work
// than this screen. Everything here is plain request/response, same
// pattern as GoalsScreen.

type Org = {
  id: string; name: string; plan: string; member_role: string;
  seats_used: number; sub_active: boolean;
};
type Member = { sid: string; name: string; email: string; role: string; joined_at: string };
type OrgTask = {
  id: string; title: string; description: string; status: string;
  priority: string; due_date: string | null; created_at: string;
};
type OrgGoal = {
  id: string; title: string; description: string; status: string;
  progress: number; due_date: string | null;
};
type OrgDoc = { id: string; title: string; created_at: string; updated_at: string };

type Tab = 'overview' | 'tasks' | 'goals' | 'docs' | 'members';

const STATUS_COLORS: Record<string, string> = {
  todo: COLORS.muted, in_progress: COLORS.accent, done: COLORS.green,
  active: COLORS.accent, completed: COLORS.green,
};

export default function OrgScreen() {
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [org,        setOrg]        = useState<Org | null>(null);
  const [members,    setMembers]    = useState<Member[]>([]);
  const [tasks,      setTasks]      = useState<OrgTask[]>([]);
  const [goals,      setGoals]      = useState<OrgGoal[]>([]);
  const [docs,       setDocs]       = useState<OrgDoc[]>([]);
  const [tab,        setTab]        = useState<Tab>('overview');

  const load = useCallback(async () => {
    try {
      const d = await api.orgGet();
      setOrg(d.org ?? null);
      setMembers(d.members ?? []);
      setTasks(d.tasks ?? []);
      setGoals(d.goals ?? []);
      setDocs(d.docs ?? []);
    } catch (_) {
      setOrg(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <SafeAreaView style={s.root}>
      <ActivityIndicator color={COLORS.accent} style={{ marginTop: 80 }} />
    </SafeAreaView>
  );

  if (!org) return <NoOrg onDone={load} />;

  return (
    <SafeAreaView style={s.root}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.accent} />}
      >
        <OrgHeader org={org} memberCount={members.length} />

        <View style={s.tabRow}>
          {(['overview', 'tasks', 'goals', 'docs', 'members'] as Tab[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[s.tabBtn, tab === t && s.tabBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
                {t[0].toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'overview' && (
          <View style={s.statsGrid}>
            <StatCard label="Tasks" value={tasks.length} />
            <StatCard label="Goals" value={goals.length} />
            <StatCard label="Docs" value={docs.length} />
            <StatCard label="Members" value={members.length} />
          </View>
        )}

        {tab === 'tasks' && <TasksTab tasks={tasks} onChanged={load} />}
        {tab === 'goals' && <GoalsTab goals={goals} onChanged={load} />}
        {tab === 'docs' && <DocsTab docs={docs} onChanged={load} />}
        {tab === 'members' && (
          <MembersTab members={members} canInvite={['owner', 'admin', 'manager'].includes(org.member_role)} onChanged={load} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── No org yet — create or join ─────────────────────────────────
function NoOrg({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'none' | 'create' | 'join'>('none');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      if (mode === 'create') await api.orgCreate(value.trim());
      else await api.orgJoin(value.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMode('none'); setValue('');
      onDone();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.emptyOrgWrap}>
        <Ionicons name="business-outline" size={40} color={COLORS.accent} style={{ marginBottom: 12 }} />
        <Text style={s.emptyTitle}>No organisation yet</Text>
        <Text style={s.emptyText}>Create one for your team, or join with an invite code from your inbox.</Text>

        {mode === 'none' && (
          <View style={{ gap: 10, marginTop: 20, width: '100%' }}>
            <TouchableOpacity style={s.primaryBtn} onPress={() => setMode('create')}>
              <Text style={s.primaryBtnTxt}>Create organisation</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => setMode('join')}>
              <Text style={s.secondaryBtnTxt}>Join with invite code</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode !== 'none' && (
          <View style={{ width: '100%', marginTop: 20, gap: 10 }}>
            <TextInput
              style={s.input}
              placeholder={mode === 'create' ? 'Organisation name' : 'Paste invite code'}
              placeholderTextColor={COLORS.muted}
              value={value}
              onChangeText={setValue}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setMode('none'); setValue(''); }}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={submit} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveTxt}>{mode === 'create' ? 'Create' : 'Join'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function OrgHeader({ org, memberCount }: { org: Org; memberCount: number }) {
  return (
    <View style={s.header}>
      <View style={s.headerIcon}>
        <Ionicons name="business" size={22} color={COLORS.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.headerName}>{org.name}</Text>
        <Text style={s.headerSub}>
          {memberCount} member{memberCount === 1 ? '' : 's'} · {org.plan}{org.sub_active ? '' : ' (free)'}
        </Text>
      </View>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statVal}>{value}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  );
}

// ── Tasks ─────────────────────────────────────────────────────
function TasksTab({ tasks, onChanged }: { tasks: OrgTask[]; onChanged: () => void }) {
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.orgTaskCreate({ title: title.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModal(false); setTitle('');
      onChanged();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(t: OrgTask) {
    const next = t.status === 'done' ? 'todo' : 'done';
    try {
      await api.orgTaskUpdate(t.id, { status: next });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChanged();
    } catch (_) {}
  }

  return (
    <View style={{ gap: 8 }}>
      <TouchableOpacity style={s.addRow} onPress={() => setModal(true)}>
        <Ionicons name="add-circle-outline" size={18} color={COLORS.accent} />
        <Text style={s.addRowTxt}>New task</Text>
      </TouchableOpacity>

      {!tasks.length && <Text style={s.emptyInline}>No org tasks yet</Text>}

      {tasks.map(t => (
        <TouchableOpacity key={t.id} style={s.listRow} onPress={() => toggleDone(t)}>
          <View style={[s.checkbox, t.status === 'done' && s.checkboxDone]}>
            {t.status === 'done' && <Ionicons name="checkmark" size={12} color="#fff" />}
          </View>
          <Text style={[s.listRowTitle, t.status === 'done' && s.listRowTitleDone]} numberOfLines={2}>
            {t.title}
          </Text>
          <View style={[s.badge, { backgroundColor: (STATUS_COLORS[t.priority] ?? COLORS.muted) + '20' }]}>
            <Text style={[s.badgeTxt, { color: STATUS_COLORS[t.priority] ?? COLORS.muted }]}>{t.priority}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>New Org Task</Text>
            <TextInput style={s.input} placeholder="Task title" placeholderTextColor={COLORS.muted}
              value={title} onChangeText={setTitle} autoFocus />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={add} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveTxt}>Add</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Goals ─────────────────────────────────────────────────────
function GoalsTab({ goals, onChanged }: { goals: OrgGoal[]; onChanged: () => void }) {
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.orgGoalCreate({ title: title.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModal(false); setTitle('');
      onChanged();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <TouchableOpacity style={s.addRow} onPress={() => setModal(true)}>
        <Ionicons name="add-circle-outline" size={18} color={COLORS.accent} />
        <Text style={s.addRowTxt}>New goal</Text>
      </TouchableOpacity>

      {!goals.length && <Text style={s.emptyInline}>No org goals yet</Text>}

      {goals.map(g => (
        <View key={g.id} style={s.listRow}>
          <Ionicons name="flag-outline" size={16} color={COLORS.amber} />
          <Text style={s.listRowTitle} numberOfLines={2}>{g.title}</Text>
          <Text style={s.progressTxt}>{g.progress}%</Text>
        </View>
      ))}

      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>New Org Goal</Text>
            <TextInput style={s.input} placeholder="Goal title" placeholderTextColor={COLORS.muted}
              value={title} onChangeText={setTitle} autoFocus />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={add} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveTxt}>Add</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Docs — read-only content view for v1 (no rich editor on mobile) ──────
function DocsTab({ docs, onChanged }: { docs: OrgDoc[]; onChanged: () => void }) {
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<{ title: string; content: string } | null>(null);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.orgDocSave(null, title.trim(), content.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModal(false); setTitle(''); setContent('');
      onChanged();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function open(docId: string) {
    try {
      const d = await api.orgDocGet(docId);
      setViewing({ title: d.doc?.title ?? 'Untitled', content: d.doc?.content ?? '' });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <TouchableOpacity style={s.addRow} onPress={() => setModal(true)}>
        <Ionicons name="add-circle-outline" size={18} color={COLORS.accent} />
        <Text style={s.addRowTxt}>New doc</Text>
      </TouchableOpacity>

      {!docs.length && <Text style={s.emptyInline}>No org docs yet</Text>}

      {docs.map(d => (
        <TouchableOpacity key={d.id} style={s.listRow} onPress={() => open(d.id)}>
          <Ionicons name="document-text-outline" size={16} color={COLORS.text2} />
          <Text style={s.listRowTitle} numberOfLines={1}>{d.title}</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
        </TouchableOpacity>
      ))}

      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>New Org Doc</Text>
            <TextInput style={s.input} placeholder="Title" placeholderTextColor={COLORS.muted}
              value={title} onChangeText={setTitle} autoFocus />
            <TextInput style={[s.input, s.textarea]} placeholder="Write something…" placeholderTextColor={COLORS.muted}
              value={content} onChangeText={setContent} multiline />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={add} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveTxt}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!viewing} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '75%' }]}>
            <Text style={s.modalTitle}>{viewing?.title}</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <Text style={s.docContent}>{viewing?.content || 'Empty document.'}</Text>
            </ScrollView>
            <TouchableOpacity style={s.saveBtn} onPress={() => setViewing(null)}>
              <Text style={s.saveTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Members ───────────────────────────────────────────────────
function MembersTab({ members, canInvite, onChanged }: { members: Member[]; canInvite: boolean; onChanged: () => void }) {
  const [modal, setModal] = useState(false);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  async function invite() {
    if (!email.trim()) return;
    setSaving(true);
    try {
      await api.orgInvite(email.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModal(false); setEmail('');
      Alert.alert('Invite sent', `${email.trim()} will get an email to join.`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      {canInvite && (
        <TouchableOpacity style={s.addRow} onPress={() => setModal(true)}>
          <Ionicons name="person-add-outline" size={18} color={COLORS.accent} />
          <Text style={s.addRowTxt}>Invite member</Text>
        </TouchableOpacity>
      )}

      {members.map(m => (
        <View key={m.sid} style={s.listRow}>
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{(m.name || '?')[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.listRowTitle}>{m.name}</Text>
            <Text style={s.memberEmail}>{m.email}</Text>
          </View>
          <View style={s.badge}>
            <Text style={s.badgeTxt}>{m.role}</Text>
          </View>
        </View>
      ))}

      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Invite Member</Text>
            <TextInput style={s.input} placeholder="teammate@email.com" placeholderTextColor={COLORS.muted}
              value={email} onChangeText={setEmail} autoFocus autoCapitalize="none" keyboardType="email-address" />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={invite} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveTxt}>Send Invite</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: COLORS.bg },
  content:        { padding: 16, gap: 12, paddingBottom: 40 },
  header:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  headerIcon:     { width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.accent + '18', alignItems: 'center', justifyContent: 'center' },
  headerName:     { fontWeight: '800', fontSize: 17, color: COLORS.text1 },
  headerSub:      { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  tabRow:         { flexDirection: 'row', backgroundColor: COLORS.bg3, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: COLORS.border },
  tabBtn:         { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8 },
  tabBtnActive:   { backgroundColor: COLORS.accent },
  tabTxt:         { fontSize: 11, fontWeight: '700', color: COLORS.muted },
  tabTxtActive:   { color: '#fff' },
  statsGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:       { flexBasis: '47%', backgroundColor: COLORS.bg3, borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  statVal:        { fontWeight: '800', fontSize: 24, color: COLORS.text1 },
  statLbl:        { fontSize: 11, color: COLORS.muted, marginTop: 4 },
  addRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  addRowTxt:      { color: COLORS.accent, fontWeight: '700', fontSize: 14 },
  emptyInline:    { color: COLORS.muted, fontSize: 13, paddingVertical: 12, textAlign: 'center' },
  listRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.bg3, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  listRowTitle:   { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.text1 },
  listRowTitleDone: { textDecorationLine: 'line-through', color: COLORS.muted },
  checkbox:       { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  checkboxDone:   { backgroundColor: COLORS.green, borderColor: COLORS.green },
  badge:          { backgroundColor: COLORS.bg2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt:       { fontSize: 10, fontWeight: '700', color: COLORS.text2, textTransform: 'capitalize' },
  progressTxt:    { fontSize: 13, fontWeight: '700', color: COLORS.amber },
  avatar:         { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.accent + '30', alignItems: 'center', justifyContent: 'center' },
  avatarTxt:      { color: COLORS.accent, fontWeight: '800', fontSize: 13 },
  memberEmail:    { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  docContent:     { fontSize: 14, color: COLORS.text2, lineHeight: 21 },
  // No-org state
  emptyOrgWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle:     { fontWeight: '800', fontSize: 18, color: COLORS.text1, marginBottom: 8 },
  emptyText:      { fontSize: 13, color: COLORS.muted, textAlign: 'center', lineHeight: 19 },
  primaryBtn:     { backgroundColor: COLORS.accent, borderRadius: 10, padding: 13, alignItems: 'center' },
  primaryBtnTxt:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondaryBtn:   { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 13, alignItems: 'center' },
  secondaryBtnTxt:{ color: COLORS.text1, fontWeight: '700', fontSize: 14 },
  // Shared modal styles (mirrors GoalsScreen)
  modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,.7)', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: COLORS.bg2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 10 },
  modalTitle:     { fontWeight: '800', fontSize: 18, color: COLORS.text1, marginBottom: 4 },
  input:          { backgroundColor: COLORS.bg3, borderRadius: 10, padding: 12, color: COLORS.text1, fontSize: 15, borderWidth: 1, borderColor: COLORS.border },
  textarea:       { minHeight: 100, textAlignVertical: 'top' },
  modalActions:   { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:      { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 13, alignItems: 'center' },
  cancelTxt:      { color: COLORS.muted, fontWeight: '600', fontSize: 14 },
  saveBtn:        { flex: 1, backgroundColor: COLORS.accent, borderRadius: 10, padding: 13, alignItems: 'center' },
  saveTxt:        { color: '#fff', fontWeight: '700', fontSize: 14 },
});
