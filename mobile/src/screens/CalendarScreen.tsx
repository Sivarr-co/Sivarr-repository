import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { COLORS } from '../theme';

// No dedicated calendar endpoint exists anywhere in SIVARR (web or backend) —
// this screen is what the web app's "calendar" concept actually is too: a
// date-grouped view over task due dates and goal deadlines, not a synced
// calendar of its own. Tasks are mobile-local (AsyncStorage, same key
// TodayScreen.tsx uses — no backend task sync on mobile yet); goals are
// server-backed via api.goals(). No calendar UI library is installed, so the
// month grid below is built from plain View/Text primitives.

type Task = { id: string; title: string; done: boolean; date?: string; priority: string };
type Goal = { id: string; title: string; deadline?: string; completed: boolean };

const TASKS_KEY = 'sivarr_tasks_mobile';

type AgendaItem = { id: string; kind: 'task' | 'goal'; title: string; date: string; done: boolean };

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toDateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

export default function CalendarScreen() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selected, setSelected] = useState(() => toDateKey(new Date()));

  const load = useCallback(async () => {
    const [tasksRaw, goalsRes] = await Promise.all([
      AsyncStorage.getItem(TASKS_KEY).catch(() => null),
      api.goals().catch(() => ({ goals: [] })),
    ]);

    let tasks: Task[] = [];
    try { tasks = tasksRaw ? JSON.parse(tasksRaw) : []; } catch { tasks = []; }
    const goals: Goal[] = goalsRes?.goals ?? [];

    const taskItems: AgendaItem[] = tasks
      .filter(t => !!t.date)
      .map(t => ({ id: `task-${t.id}`, kind: 'task', title: t.title, date: t.date as string, done: t.done }));

    const goalItems: AgendaItem[] = goals
      .filter(g => !!g.deadline)
      .map(g => ({ id: `goal-${g.id}`, kind: 'goal', title: g.title, date: g.deadline as string, done: g.completed }));

    setItems([...taskItems, ...goalItems]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const itemsByDate = useMemo(() => {
    const map: Record<string, AgendaItem[]> = {};
    for (const it of items) {
      (map[it.date] ??= []).push(it);
    }
    return map;
  }, [items]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const selectedItems = (itemsByDate[selected] ?? []).sort((a, b) => Number(a.done) - Number(b.done));
  const todayKey = toDateKey(new Date());

  function shiftMonth(delta: number) {
    setCursor(prev => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  }

  if (loading) return (
    <SafeAreaView style={s.root}>
      <ActivityIndicator color={COLORS.accent} style={{ marginTop: 80 }} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>Calendar</Text>

        <View style={s.monthHeader}>
          <TouchableOpacity onPress={() => shiftMonth(-1)} style={s.monthArrow}>
            <Ionicons name="chevron-back" size={20} color={COLORS.text1} />
          </TouchableOpacity>
          <Text style={s.monthLabel}>{MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}</Text>
          <TouchableOpacity onPress={() => shiftMonth(1)} style={s.monthArrow}>
            <Ionicons name="chevron-forward" size={20} color={COLORS.text1} />
          </TouchableOpacity>
        </View>

        <View style={s.weekdayRow}>
          {WEEKDAY_LABELS.map((w, i) => (
            <Text key={i} style={s.weekdayLabel}>{w}</Text>
          ))}
        </View>

        <View style={s.grid}>
          {grid.map((week, wi) => (
            <View key={wi} style={s.gridRow}>
              {week.map((cell, ci) => {
                if (!cell) return <View key={ci} style={s.dayCell} />;
                const key = toDateKey(cell);
                const dayItems = itemsByDate[key] ?? [];
                const isSelected = key === selected;
                const isToday = key === todayKey;
                return (
                  <TouchableOpacity
                    key={ci}
                    style={[s.dayCell, isSelected && s.dayCellSelected]}
                    onPress={() => setSelected(key)}
                  >
                    <Text style={[
                      s.dayNum,
                      isToday && !isSelected && s.dayNumToday,
                      isSelected && s.dayNumSelected,
                    ]}>
                      {cell.getDate()}
                    </Text>
                    {dayItems.length > 0 && (
                      <View style={s.dotsRow}>
                        {dayItems.slice(0, 3).map(it => (
                          <View
                            key={it.id}
                            style={[
                              s.dot,
                              { backgroundColor: it.kind === 'goal' ? COLORS.amber : COLORS.accent },
                              it.done && s.dotDone,
                            ]}
                          />
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        <Text style={s.sectionLabel}>
          {selected === todayKey ? 'Today' : formatAgendaDate(selected)}
        </Text>

        {!selectedItems.length && (
          <View style={s.empty}>
            <Text style={s.emptyText}>Nothing due this day</Text>
          </View>
        )}

        {selectedItems.map(it => (
          <View key={it.id} style={s.agendaRow}>
            <Ionicons
              name={it.kind === 'goal' ? 'flag' : 'checkmark-circle-outline'}
              size={16}
              color={it.kind === 'goal' ? COLORS.amber : COLORS.accent}
            />
            <Text style={[s.agendaTitle, it.done && s.agendaTitleDone]} numberOfLines={2}>
              {it.title}
            </Text>
            {it.done && <Ionicons name="checkmark" size={16} color={COLORS.green} />}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function buildMonthGrid(monthStart: Date): (Date | null)[][] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function formatAgendaDate(key: string): string {
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: COLORS.bg },
  content:         { padding: 16, gap: 10, paddingBottom: 40 },
  title:           { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5, marginBottom: 4 },
  monthHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  monthArrow:      { padding: 6 },
  monthLabel:      { fontWeight: '700', fontSize: 16, color: COLORS.text1 },
  weekdayRow:      { flexDirection: 'row', marginTop: 8 },
  weekdayLabel:    { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: COLORS.muted },
  grid:            { gap: 4, marginTop: 4 },
  gridRow:         { flexDirection: 'row' },
  dayCell:         { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, gap: 3 },
  dayCellSelected: { backgroundColor: COLORS.accent },
  dayNum:          { fontSize: 13, fontWeight: '600', color: COLORS.text1 },
  dayNumToday:     { color: COLORS.accent, fontWeight: '800' },
  dayNumSelected:  { color: '#fff', fontWeight: '800' },
  dotsRow:         { flexDirection: 'row', gap: 3 },
  dot:             { width: 4, height: 4, borderRadius: 2 },
  dotDone:         { opacity: 0.35 },
  sectionLabel:    { fontSize: 13, fontWeight: '700', color: COLORS.text1, marginTop: 14, marginBottom: 2 },
  empty:           { paddingVertical: 20, alignItems: 'center' },
  emptyText:       { fontSize: 13, color: COLORS.muted },
  agendaRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.bg3, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  agendaTitle:     { flex: 1, fontSize: 14, color: COLORS.text1, fontWeight: '600' },
  agendaTitleDone: { textDecorationLine: 'line-through', color: COLORS.muted },
});
