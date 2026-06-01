import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../theme';

type Task = { id: string; title: string; done: boolean; priority: string };

const STORAGE_KEY = 'sivarr_tasks_mobile';

async function loadTasks(): Promise<Task[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveTasks(tasks: Task[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export default function TasksScreen() {
  const [tasks,   setTasks] = useState<Task[]>([]);
  const [input,   setInput] = useState('');
  const [loaded,  setLoaded] = useState(false);

  React.useEffect(() => {
    loadTasks().then(t => { setTasks(t); setLoaded(true); });
  }, []);

  async function addTask() {
    if (!input.trim()) return;
    const t: Task = { id: Date.now().toString(), title: input.trim(), done: false, priority: 'medium' };
    const updated = [t, ...tasks];
    setTasks(updated);
    saveTasks(updated);
    setInput('');
  }

  async function toggleTask(id: string) {
    const updated = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated);
    saveTasks(updated);
  }

  async function deleteTask(id: string) {
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    saveTasks(updated);
  }

  const open = tasks.filter(t => !t.done);
  const done = tasks.filter(t =>  t.done);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>Tasks</Text>
        <Text style={s.sub}>{open.length} open · {done.length} done</Text>
      </View>

      <View style={s.addRow}>
        <TextInput
          style={s.addInput}
          placeholder="Add a task…"
          placeholderTextColor={COLORS.muted}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={addTask}
          returnKeyType="done"
        />
        <TouchableOpacity style={s.addBtn} onPress={addTask}>
          <Text style={s.addBtnTxt}>+</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={[...open, ...done]}
        keyExtractor={t => t.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        renderItem={({ item: t }) => (
          <TouchableOpacity
            style={[s.taskCard, t.done && s.taskDone]}
            onPress={() => toggleTask(t.id)}
            onLongPress={() => Alert.alert('Delete task?', t.title, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteTask(t.id) },
            ])}
          >
            <View style={[s.check, t.done && s.checkDone]}>
              {t.done && <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>✓</Text>}
            </View>
            <Text style={[s.taskTitle, t.done && s.taskTitleDone]}>{t.title}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={s.empty}>No tasks yet — add your first one above.</Text>}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.bg },
  header:       { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: COLORS.border },
  title:        { fontWeight: '800', fontSize: 18, color: COLORS.text1 },
  sub:          { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  addRow:       { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 8 },
  addInput:     { flex: 1, backgroundColor: COLORS.bg3, borderRadius: 12, paddingHorizontal: 14,
                  paddingVertical: 12, color: COLORS.text1, fontSize: 14, borderWidth: 1, borderColor: COLORS.border },
  addBtn:       { width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  addBtnTxt:    { color: '#fff', fontSize: 24, fontWeight: '300', lineHeight: 28 },
  taskCard:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.bg3, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  taskDone:     { opacity: 0.5 },
  check:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  checkDone:    { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  taskTitle:    { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.text1 },
  taskTitleDone:{ textDecorationLine: 'line-through', color: COLORS.muted },
  empty:        { textAlign: 'center', color: COLORS.muted, paddingTop: 60, fontSize: 14 },
});
