import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Modal, Animated, Pressable, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { COLORS } from '../theme';

// ── Types ─────────────────────────────────────────────────────
type Task   = { id: string; title: string; done: boolean; date?: string; priority: string };
type Habit  = { id: string; title: string; emoji: string; completions: string[]; streak: number };
type Goal   = { id: string; title: string; progress: number; deadline?: string; completed: boolean };

const TASKS_KEY  = 'sivarr_tasks_mobile';
const HABITS_KEY = 'sivarr_habits_mobile';
const today      = () => new Date().toISOString().split('T')[0];

// ── Helpers ───────────────────────────────────────────────────
async function loadTasks():  Promise<Task[]>  { try { return JSON.parse(await AsyncStorage.getItem(TASKS_KEY)  ?? '[]') } catch { return [] } }
async function saveTasks(t:  Task[])  { await AsyncStorage.setItem(TASKS_KEY,  JSON.stringify(t)) }
async function loadHabits(): Promise<Habit[]> { try { return JSON.parse(await AsyncStorage.getItem(HABITS_KEY) ?? '[]') } catch { return [] } }
async function saveHabits(h: Habit[]) { await AsyncStorage.setItem(HABITS_KEY, JSON.stringify(h)) }

// ── Task row ─────────────────────────────────────────────────
function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const strike = useRef(new Animated.Value(task.done ? 1 : 0)).current;
  const scale  = useRef(new Animated.Value(1)).current;

  function handle() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 40 }),
      Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 20 }),
    ]).start();
    Animated.timing(strike, {
      toValue: task.done ? 0 : 1, duration: 200, useNativeDriver: false,
    }).start();
    onToggle();
  }

  const txtColor = strike.interpolate({ inputRange: [0, 1], outputRange: [COLORS.text1, COLORS.muted] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable style={s.taskRow} onPress={handle}>
        <View style={[s.taskCheck, task.done && s.taskCheckDone]}>
          {task.done && <Ionicons name="checkmark" size={13} color="#fff" />}
        </View>
        <Animated.Text style={[s.taskTitle, { color: txtColor, textDecorationLine: task.done ? 'line-through' : 'none' }]}>
          {task.title}
        </Animated.Text>
        {task.priority === 'high' && !task.done && (
          <View style={s.priorityDot} />
        )}
      </Pressable>
    </Animated.View>
  );
}

// ── Habit bubble ─────────────────────────────────────────────
function HabitBubble({ habit, onToggle }: { habit: Habit; onToggle: () => void }) {
  const done  = habit.completions.includes(today());
  const scale = useRef(new Animated.Value(1)).current;

  function handle() {
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.85, useNativeDriver: true, speed: 50 }),
      Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 20 }),
    ]).start();
    Haptics.impactAsync(done ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
    onToggle();
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity style={[s.bubble, done && s.bubbleDone]} onPress={handle} activeOpacity={0.8}>
        <Text style={s.bubbleEmoji}>{habit.emoji}</Text>
        {done && (
          <View style={s.bubbleCheck}>
            <Ionicons name="checkmark" size={9} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
      <Text style={[s.bubbleLabel, done && s.bubbleLabelDone]} numberOfLines={1}>{habit.title.split(' ')[0]}</Text>
    </Animated.View>
  );
}

// ── Main screen ───────────────────────────────────────────────
export default function TodayScreen({ navigation }: { navigation: any }) {
  const [tasks,       setTasks]    = useState<Task[]>([]);
  const [habits,      setHabits]   = useState<Habit[]>([]);
  const [goals,       setGoals]    = useState<Goal[]>([]);
  const [brief,       setBrief]    = useState('Loading your daily brief…');
  const [briefLoaded, setBriefLoaded] = useState(false);
  const [capture,     setCapture]  = useState(false);
  const [captureText, setCaptureText] = useState('');
  const [captureType, setCaptureType] = useState<'task' | 'note'>('task');
  const slideAnim = useRef(new Animated.Value(300)).current;

  const todayStr  = today();
  const hour      = new Date().getHours();
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const load = useCallback(async () => {
    const [t, h] = await Promise.all([loadTasks(), loadHabits()]);
    setTasks(t); setHabits(h);
    try {
      const d = await api.goals();
      setGoals((d.goals ?? []).filter((g: Goal) => !g.completed).slice(0, 2));
    } catch(_) {}
    try {
      const d = await api.homeBrief({ open_tasks: t.filter(x => !x.done).length, streak: 0 });
      if (d.brief) { setBrief(d.brief); setBriefLoaded(true); }
    } catch(_) { setBrief('Ready to make today count? Let\'s go.'); setBriefLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Show tasks due today + overdue + undated (up to 5)
  const todayTasks = tasks
    .filter(t => !t.date || t.date <= todayStr)
    .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
    .slice(0, 6);

  const habitsDoneToday = habits.filter(h => h.completions.includes(todayStr)).length;

  async function toggleTask(id: string) {
    const updated = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated); await saveTasks(updated);
  }

  async function toggleHabit(id: string) {
    const updated = habits.map(h => {
      if (h.id !== id) return h;
      const done = h.completions.includes(todayStr);
      return {
        ...h,
        completions: done ? h.completions.filter(d => d !== todayStr) : [...h.completions, todayStr],
        streak: done ? Math.max(0, h.streak - 1) : h.streak + 1,
      };
    });
    setHabits(updated); await saveHabits(updated);
  }

  function openCapture() {
    setCapture(true);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
  }
  function closeCapture() {
    Animated.timing(slideAnim, { toValue: 400, duration: 220, useNativeDriver: true }).start(() => {
      setCapture(false); setCaptureText(''); setCaptureType('task');
    });
  }

  async function saveCapture() {
    if (!captureText.trim()) return;
    const text = captureText.trim();

    if (captureType === 'task') {
      const task: Task = { id: Date.now().toString(), title: text, done: false, date: todayStr, priority: 'normal' };
      const updated = [task, ...tasks];
      setTasks(updated); await saveTasks(updated);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeCapture();
    } else {
      // Note mode — extract tasks via AI
      closeCapture();
      try {
        const res = await api.voiceToTask(text);
        if (res.ok && res.tasks?.length) {
          const newTasks: Task[] = res.tasks.map((t: any) => ({
            id:       Date.now().toString() + Math.random(),
            title:    t.title || text,
            done:     false,
            date:     t.due || todayStr,
            priority: t.priority || 'normal',
          }));
          const updated = [...newTasks, ...tasks];
          setTasks(updated); await saveTasks(updated);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch(_) {
        // Fallback — save as-is
        const task: Task = { id: Date.now().toString(), title: text, done: false, date: todayStr, priority: 'normal' };
        const updated = [task, ...tasks];
        setTasks(updated); await saveTasks(updated);
      }
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>{greeting} 👋</Text>
            <Text style={s.date}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </View>
          <TouchableOpacity style={s.avatarBtn} onPress={() => navigation.navigate('Me')}>
            <Text style={s.avatarTxt}>H</Text>
          </TouchableOpacity>
        </View>

        {/* AI Brief */}
        <TouchableOpacity style={s.briefCard} onPress={() => navigation.navigate('AI')} activeOpacity={0.8}>
          <View style={s.briefTop}>
            <View style={s.briefOrb}>
              <Text style={{ fontSize: 14 }}>✦</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.briefName}>SIVARR AI</Text>
              <Text style={s.briefSub}>Daily brief  ·  tap to chat</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={COLORS.muted} />
          </View>
          <Text style={s.briefText} numberOfLines={3}>{brief}</Text>
        </TouchableOpacity>

        {/* Tasks */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Today's tasks</Text>
            <TouchableOpacity onPress={openCapture}>
              <Text style={s.sectionAction}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {todayTasks.length === 0 && (
            <TouchableOpacity style={s.emptyTask} onPress={openCapture}>
              <Ionicons name="add-circle-outline" size={20} color={COLORS.muted} />
              <Text style={s.emptyTaskTxt}>Add your first task for today</Text>
            </TouchableOpacity>
          )}

          {todayTasks.map(t => (
            <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t.id)} />
          ))}

          {tasks.filter(t => !t.done && (!t.date || t.date <= todayStr)).length > 5 && (
            <Text style={s.moreTasksTxt}>
              +{tasks.filter(t => !t.done && (!t.date || t.date <= todayStr)).length - 5} more tasks
            </Text>
          )}
        </View>

        {/* Habits */}
        {habits.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Habits</Text>
              <Text style={s.habitCount}>
                <Text style={{ color: COLORS.accent, fontWeight: '700' }}>{habitsDoneToday}</Text>
                <Text style={{ color: COLORS.muted }}> / {habits.length}</Text>
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.bubbleRow}>
              {habits.map(h => (
                <HabitBubble key={h.id} habit={h} onToggle={() => toggleHabit(h.id)} />
              ))}
            </ScrollView>
          </View>
        )}

        {habits.length === 0 && (
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Habits</Text>
            </View>
            <TouchableOpacity style={s.emptyTask} onPress={() => navigation.navigate('Me')}>
              <Ionicons name="flame-outline" size={20} color={COLORS.muted} />
              <Text style={s.emptyTaskTxt}>Set up daily habits in Me tab</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Goals snapshot */}
        {goals.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Goals</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Me')}>
                <Text style={s.sectionAction}>View all</Text>
              </TouchableOpacity>
            </View>
            {goals.map(g => {
              const days = g.deadline
                ? Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000)
                : null;
              return (
                <View key={g.id} style={s.goalCard}>
                  <View style={s.goalCardTop}>
                    <Text style={s.goalTitle} numberOfLines={1}>{g.title}</Text>
                    {days !== null && (
                      <Text style={[s.goalDays, days <= 3 && { color: COLORS.red }]}>
                        {days <= 0 ? 'Due!' : `${days}d`}
                      </Text>
                    )}
                  </View>
                  <View style={s.goalBar}>
                    <View style={[s.goalFill, { width: `${g.progress}%` as any }]} />
                  </View>
                  <Text style={s.goalPct}>{g.progress}% complete</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating action button */}
      <TouchableOpacity style={s.fab} onPress={openCapture} activeOpacity={0.85}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      {/* Quick capture modal */}
      <Modal visible={capture} transparent animationType="none" onRequestClose={closeCapture}>
        <Pressable style={s.captureOverlay} onPress={closeCapture}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
            <Animated.View style={[s.captureSheet, { transform: [{ translateY: slideAnim }] }]}>
              <Pressable>
                <View style={s.captureHandle} />

                {/* Type tabs */}
                <View style={s.captureTypeTabs}>
                  {(['task', 'note'] as const).map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[s.captureTypeBtn, captureType === type && s.captureTypeBtnActive]}
                      onPress={() => setCaptureType(type)}
                    >
                      <Text style={[s.captureTypeTxt, captureType === type && s.captureTypeTxtActive]}>
                        {type === 'task' ? '📋  Task' : '🎤  Voice / Note'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TextInput
                  style={s.captureInput}
                  placeholder={captureType === 'task' ? 'What needs to be done?' : 'Dictate or type a note — SIVA will extract tasks from it…'}
                  placeholderTextColor={COLORS.muted}
                  value={captureText}
                  onChangeText={setCaptureText}
                  autoFocus
                  multiline={captureType === 'note'}
                  onSubmitEditing={captureType === 'task' ? saveCapture : undefined}
                  returnKeyType={captureType === 'task' ? 'done' : 'default'}
                />

                <TouchableOpacity
                  style={[s.captureBtn, !captureText.trim() && s.captureBtnOff]}
                  onPress={saveCapture}
                  disabled={!captureText.trim()}
                >
                  <Text style={s.captureBtnTxt}>{captureType === 'task' ? 'Add task' : 'Extract tasks ✦'}</Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </TouchableOpacity>
              </Pressable>
            </Animated.View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: COLORS.bg },
  scroll:           { padding: 20, paddingTop: 12 },

  // Header
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greeting:         { fontWeight: '800', fontSize: 24, color: COLORS.text1, letterSpacing: -0.5 },
  date:             { fontSize: 13, color: COLORS.muted, marginTop: 2, fontWeight: '500' },
  avatarBtn:        { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:        { fontWeight: '800', fontSize: 16, color: '#fff' },

  // AI Brief card
  briefCard:        { backgroundColor: COLORS.bg3, borderRadius: 18, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border },
  briefTop:         { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  briefOrb:         { width: 34, height: 34, borderRadius: 10, backgroundColor: COLORS.accent + '25', alignItems: 'center', justifyContent: 'center' },
  briefName:        { fontWeight: '700', fontSize: 13, color: COLORS.accent },
  briefSub:         { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  briefText:        { fontSize: 14, color: COLORS.text2, lineHeight: 22 },

  // Section
  section:          { marginBottom: 28 },
  sectionHead:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle:     { fontWeight: '700', fontSize: 13, color: COLORS.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionAction:    { fontSize: 13, fontWeight: '600', color: COLORS.accent },
  habitCount:       { fontSize: 13, fontWeight: '600' },

  // Task
  taskRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderColor: COLORS.border + '60' },
  taskCheck:        { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  taskCheckDone:    { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  taskTitle:        { flex: 1, fontSize: 15, fontWeight: '500', lineHeight: 20 },
  priorityDot:      { width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.red, flexShrink: 0 },
  emptyTask:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16, paddingHorizontal: 4 },
  emptyTaskTxt:     { fontSize: 14, color: COLORS.muted },
  moreTasksTxt:     { fontSize: 12, color: COLORS.muted, textAlign: 'center', marginTop: 8 },

  // Habits
  bubbleRow:        { gap: 14, paddingBottom: 4 },
  bubble:           { width: 58, height: 58, borderRadius: 18, backgroundColor: COLORS.bg3, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.border, marginBottom: 6, position: 'relative' },
  bubbleDone:       { borderColor: COLORS.accent, backgroundColor: COLORS.accent + '15' },
  bubbleEmoji:      { fontSize: 26 },
  bubbleCheck:      { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  bubbleLabel:      { fontSize: 11, color: COLORS.muted, textAlign: 'center', fontWeight: '500' },
  bubbleLabelDone:  { color: COLORS.accent },

  // Goals
  goalCard:         { backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  goalCardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  goalTitle:        { flex: 1, fontWeight: '700', fontSize: 14, color: COLORS.text1 },
  goalDays:         { fontSize: 12, fontWeight: '700', color: COLORS.muted, marginLeft: 8 },
  goalBar:          { height: 5, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  goalFill:         { height: '100%', backgroundColor: COLORS.accent, borderRadius: 3 },
  goalPct:          { fontSize: 11, color: COLORS.muted },

  // FAB
  fab:              { position: 'absolute', bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },

  // Quick capture
  captureOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,.6)', justifyContent: 'flex-end' },
  captureSheet:     { backgroundColor: COLORS.bg2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  captureHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 20 },
  captureTypeTabs:  { flexDirection: 'row', gap: 8, marginBottom: 16 },
  captureTypeBtn:   { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: COLORS.bg3, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  captureTypeBtnActive: { backgroundColor: COLORS.accent + '20', borderColor: COLORS.accent },
  captureTypeTxt:   { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  captureTypeTxtActive: { color: COLORS.accent },
  captureInput:     { backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, fontSize: 16, color: COLORS.text1, marginBottom: 14, minHeight: 52, borderWidth: 1, borderColor: COLORS.border },
  captureBtn:       { backgroundColor: COLORS.accent, borderRadius: 14, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  captureBtnOff:    { backgroundColor: COLORS.muted },
  captureBtnTxt:    { color: '#fff', fontWeight: '700', fontSize: 15 },
});
