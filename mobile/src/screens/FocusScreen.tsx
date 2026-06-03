import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing,
  TextInput, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { COLORS } from '../theme';

const FOCUS_LOG_KEY = 'sivarr_focus_log_mobile';

type Mode = { label: string; mins: number; color: string };
const MODES: Record<string, Mode> = {
  focus:  { label: 'Focus',       mins: 25, color: COLORS.accent },
  short:  { label: 'Short Break', mins: 5,  color: '#22c55e' },
  long:   { label: 'Long Break',  mins: 15, color: '#f59e0b' },
};

const CIRC = 2 * Math.PI * 90; // r=90

type LogEntry = { task: string; duration: number; date: string };

export default function FocusScreen() {
  const [mode,       setMode]       = useState<string>('focus');
  const [running,    setRunning]    = useState(false);
  const [remaining,  setRemaining]  = useState(MODES.focus.mins * 60);
  const [session,    setSession]    = useState(1);
  const [taskName,   setTaskName]   = useState('');
  const [done,       setDone]       = useState(false);
  const [log,        setLog]        = useState<LogEntry[]>([]);

  const duration   = useRef(MODES.focus.mins * 60);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progress    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(FOCUS_LOG_KEY).then(raw => {
      try { setLog(JSON.parse(raw ?? '[]')); } catch { setLog([]); }
    });
  }, []);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setRunning(false);
  }, []);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  function applyMode(m: string) {
    stopTimer();
    setMode(m);
    const secs = MODES[m].mins * 60;
    duration.current = secs;
    setRemaining(secs);
    setDone(false);
    progress.setValue(0);
    Haptics.selectionAsync();
  }

  function toggle() {
    if (done) return;
    if (running) {
      stopTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      intervalRef.current = setInterval(() => {
        setRemaining(prev => {
          const next = prev - 1;
          const pct  = 1 - next / duration.current;
          progress.setValue(pct);
          if (next <= 0) {
            clearInterval(intervalRef.current!);
            intervalRef.current = null;
            setRunning(false);
            onSessionComplete();
            return 0;
          }
          return next;
        });
      }, 1000);
      setRunning(true);
    }
  }

  async function onSessionComplete() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (mode === 'focus') {
      const entry: LogEntry = {
        task:     taskName.trim() || 'Focus Session',
        duration: MODES.focus.mins,
        date:     new Date().toISOString().split('T')[0],
      };
      const updated = [entry, ...log].slice(0, 50);
      setLog(updated);
      await AsyncStorage.setItem(FOCUS_LOG_KEY, JSON.stringify(updated));
      setDone(true);
      setSession(s => s + 1);
    } else {
      // Break over — switch back to focus
      applyMode('focus');
    }
  }

  function reset() {
    stopTimer();
    const secs = MODES[mode].mins * 60;
    duration.current = secs;
    setRemaining(secs);
    setDone(false);
    progress.setValue(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function nextSession() {
    const next = session % 4 === 0 ? 'long' : 'short';
    applyMode(next);
  }

  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  const strokeDash = progress.interpolate({ inputRange: [0, 1], outputRange: [CIRC, 0] });
  const modeColor  = MODES[mode].color;
  const sessionDots = [1, 2, 3, 4].map(i => i <= (session - 1) % 4 + (done && mode === 'focus' ? 1 : 0));

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Title */}
        <View style={s.topRow}>
          <Text style={s.title}>Focus</Text>
          <Text style={s.sessionTxt}>Session {session}</Text>
        </View>

        {/* Mode tabs */}
        <View style={s.modeTabs}>
          {Object.entries(MODES).map(([key, m]) => (
            <TouchableOpacity
              key={key}
              style={[s.modeTab, mode === key && { backgroundColor: m.color + '22', borderColor: m.color }]}
              onPress={() => applyMode(key)}
            >
              <Text style={[s.modeTabTxt, mode === key && { color: m.color, fontWeight: '700' }]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Timer ring */}
        <View style={s.ringWrap}>
          <Svg width={220} height={220} viewBox="0 0 200 200">
            <Defs>
              <LinearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor={modeColor} stopOpacity="1" />
                <Stop offset="100%" stopColor={COLORS.accent2} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            {/* Track */}
            <Circle cx="100" cy="100" r="90" fill="none"
              stroke={COLORS.border} strokeWidth="10" />
            {/* Progress — we use Animated.View wrapper trick via direct state */}
            <Circle cx="100" cy="100" r="90" fill="none"
              stroke={modeColor} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={remaining === 0 ? 0 : CIRC * (remaining / duration.current)}
              transform="rotate(-90 100 100)"
            />
          </Svg>

          {/* Time in center */}
          <View style={s.ringInner}>
            {done ? (
              <>
                <Text style={[s.doneEmoji]}>🎉</Text>
                <Text style={[s.timeTxt, { color: modeColor }]}>Done!</Text>
              </>
            ) : (
              <>
                <Text style={[s.timeTxt, { color: COLORS.text1 }]}>{mins}:{secs}</Text>
                <Text style={[s.modeLbl, { color: modeColor }]}>{MODES[mode].label}</Text>
              </>
            )}
          </View>
        </View>

        {/* Session dots */}
        <View style={s.dotsRow}>
          {sessionDots.map((filled, i) => (
            <View key={i} style={[s.dot, filled && { backgroundColor: COLORS.accent }]} />
          ))}
        </View>

        {/* Task input (focus mode only) */}
        {mode === 'focus' && !done && (
          <TextInput
            style={s.taskInput}
            placeholder="What are you focusing on?"
            placeholderTextColor={COLORS.muted}
            value={taskName}
            onChangeText={setTaskName}
            returnKeyType="done"
            editable={!running}
          />
        )}

        {/* Controls */}
        {!done ? (
          <View style={s.controls}>
            <TouchableOpacity style={s.ctrlSec} onPress={reset}>
              <Ionicons name="refresh" size={20} color={COLORS.muted} />
            </TouchableOpacity>
            <TouchableOpacity style={[s.ctrlPri, { backgroundColor: modeColor }]} onPress={toggle} activeOpacity={0.85}>
              <Ionicons name={running ? 'pause' : 'play'} size={28} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={s.ctrlSec} onPress={() => Alert.alert('End session?', '', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'End', style: 'destructive', onPress: reset },
            ])}>
              <Ionicons name="stop" size={20} color={COLORS.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.doneActions}>
            <TouchableOpacity style={s.doneSecBtn} onPress={() => applyMode('focus')}>
              <Ionicons name="refresh-outline" size={16} color={COLORS.accent} />
              <Text style={s.doneSecTxt}>Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.donePriBtn, { backgroundColor: modeColor }]} onPress={nextSession}>
              <Text style={s.donePriTxt}>
                {session % 4 === 0 ? 'Long Break' : 'Short Break'}
              </Text>
              <Ionicons name="arrow-forward" size={15} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Recent sessions */}
        {log.length > 0 && (
          <View style={s.logSection}>
            <Text style={s.logTitle}>Recent sessions</Text>
            {log.slice(0, 5).map((entry, i) => (
              <View key={i} style={s.logRow}>
                <View style={s.logDot} />
                <View style={{ flex: 1 }}>
                  <Text style={s.logTask} numberOfLines={1}>{entry.task}</Text>
                  <Text style={s.logMeta}>{entry.date} · {entry.duration} min</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: COLORS.bg },
  scroll:      { padding: 20, alignItems: 'center' },

  topRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 20 },
  title:       { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5 },
  sessionTxt:  { fontSize: 13, color: COLORS.muted, fontWeight: '600' },

  modeTabs:    { flexDirection: 'row', gap: 8, marginBottom: 32, width: '100%' },
  modeTab:     { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', backgroundColor: COLORS.bg3 },
  modeTabTxt:  { fontSize: 12, fontWeight: '600', color: COLORS.muted },

  ringWrap:    { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  ringInner:   { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  timeTxt:     { fontWeight: '800', fontSize: 38, letterSpacing: -1, fontVariant: ['tabular-nums'] as any },
  modeLbl:     { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 },
  doneEmoji:   { fontSize: 28, marginBottom: 4 },

  dotsRow:     { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.border },

  taskInput:   { width: '100%', backgroundColor: COLORS.bg3, borderRadius: 12, padding: 14, fontSize: 15, color: COLORS.text1, borderWidth: 1, borderColor: COLORS.border, marginBottom: 24 },

  controls:    { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 32 },
  ctrlSec:     { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.bg3, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  ctrlPri:     { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },

  doneActions: { flexDirection: 'row', gap: 10, width: '100%', marginBottom: 32 },
  doneSecBtn:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.accent + '20', borderRadius: 12, padding: 13, borderWidth: 1, borderColor: COLORS.accent + '40' },
  doneSecTxt:  { fontWeight: '700', fontSize: 14, color: COLORS.accent },
  donePriBtn:  { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, padding: 13 },
  donePriTxt:  { fontWeight: '700', fontSize: 14, color: '#fff' },

  logSection:  { width: '100%', marginTop: 8 },
  logTitle:    { fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  logRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: COLORS.border + '60' },
  logDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent, flexShrink: 0 },
  logTask:     { fontSize: 14, fontWeight: '600', color: COLORS.text1 },
  logMeta:     { fontSize: 12, color: COLORS.muted, marginTop: 2 },
});
