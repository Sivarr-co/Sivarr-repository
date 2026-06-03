import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { api }    from '../api/client';
import { COLORS } from '../theme';

type Msg = {
  id:   string;
  role: 'user' | 'ai';
  text: string;
};

const CHIPS = [
  { label: 'Brainstorm', prompt: 'Help me brainstorm ideas for ' },
  { label: 'Write',      prompt: 'Help me write ' },
  { label: 'Make a plan',prompt: 'Make a plan for ' },
  { label: 'Summarise',  prompt: 'Summarise this for me: ' },
];

const TASKS_KEY = 'sivarr_tasks_mobile';

function MsgBubble({ msg, onSaveTask }: { msg: Msg; onSaveTask?: (text: string) => void }) {
  const isAI = msg.role === 'ai';
  // Detect if the AI message looks like it contains tasks / action items
  const hasActions = isAI && (
    msg.text.includes('1.') || msg.text.includes('- ') ||
    msg.text.toLowerCase().includes('you should') ||
    msg.text.toLowerCase().includes('i recommend') ||
    msg.text.toLowerCase().includes('next step')
  );

  return (
    <View style={[s.bubble, isAI ? s.bubbleAI : s.bubbleUser]}>
      {isAI && (
        <View style={s.aiMark}>
          <Text style={s.aiMarkTxt}>✦</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[s.bubbleText, !isAI && s.bubbleTextUser]}>{msg.text}</Text>
        {hasActions && onSaveTask && (
          <TouchableOpacity style={s.saveTaskBtn} onPress={() => onSaveTask(msg.text)}>
            <Ionicons name="add-circle-outline" size={14} color={COLORS.accent} />
            <Text style={s.saveTaskTxt}>Extract as tasks</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function AIScreen() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      id:   '0',
      role: 'ai',
      text: 'Hi! I\'m SIVARR AI — your intelligent productivity assistant.\n\nAsk me anything or use one of the quick actions below.',
    },
  ]);
  const [input,   setInput]  = useState('');
  const [loading, setLoad]   = useState(false);
  const [chips,   setChips]  = useState(true);
  const listRef              = useRef<FlatList>(null);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput(''); setChips(false);

    const userMsg: Msg = { id: Date.now().toString(), role: 'user', text: msg };
    setMessages(prev => [...prev, userMsg]);
    setLoad(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const d = await api.aiChat(msg);
      const aiMsg: Msg = {
        id:   (Date.now() + 1).toString(),
        role: 'ai',
        text: d.response ?? d.answer ?? 'Something went wrong. Please try again.',
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch(_) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'ai',
        text: 'Sorry, I couldn\'t reach the server. Check your connection.',
      }]);
    } finally {
      setLoad(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  async function extractTasks(aiText: string) {
    // Parse bullet points / numbered items from AI response
    const lines = aiText.split('\n').map(l => l.trim()).filter(l =>
      /^(\d+\.|[-•*])/.test(l)
    ).map(l => l.replace(/^(\d+\.|\s*[-•*])\s*/, '').trim()).filter(Boolean);

    if (!lines.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    try {
      const existing = JSON.parse(await AsyncStorage.getItem(TASKS_KEY) ?? '[]');
      const newTasks = lines.slice(0, 5).map(title => ({
        id:       Date.now().toString() + Math.random(),
        title,
        done:     false,
        priority: 'normal',
      }));
      await AsyncStorage.setItem(TASKS_KEY, JSON.stringify([...newTasks, ...existing]));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessages(prev => [...prev, {
        id:   Date.now().toString(),
        role: 'ai',
        text: `✓ Added ${newTasks.length} task${newTasks.length > 1 ? 's' : ''} to Today. Switch to the Today tab to see them.`,
      }]);
    } catch(_) {}
  }

  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerOrb}>
          <Text style={{ fontSize: 16 }}>✦</Text>
        </View>
        <View>
          <Text style={s.headerName}>SIVARR AI</Text>
          <View style={s.statusRow}>
            <View style={s.statusDot} />
            <Text style={s.statusTxt}>Online · Ready</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={s.msgs}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <MsgBubble msg={item} onSaveTask={item.role === 'ai' ? extractTasks : undefined} />
          )}
          ListFooterComponent={loading ? (
            <View style={s.typingRow}>
              <View style={s.aiMark}><Text style={s.aiMarkTxt}>✦</Text></View>
              <ActivityIndicator color={COLORS.accent} size="small" />
            </View>
          ) : null}
        />

        {/* Quick chips (shown only at start) */}
        {chips && (
          <View style={s.chipsWrap}>
            {CHIPS.map(c => (
              <TouchableOpacity key={c.label} style={s.chip} onPress={() => { setInput(c.prompt); setChips(false); }}>
                <Text style={s.chipTxt}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Input bar */}
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            placeholder="Ask SIVARR anything…"
            placeholderTextColor={COLORS.muted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnOff]}
            onPress={() => send()}
            disabled={!input.trim() || loading}
          >
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.bg },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderColor: COLORS.border },
  headerOrb:    { width: 40, height: 40, borderRadius: 14, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  headerName:   { fontWeight: '800', fontSize: 15, color: COLORS.text1 },
  statusRow:    { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot:    { width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.accent },
  statusTxt:    { fontSize: 11, color: COLORS.muted },

  // Messages
  msgs:         { padding: 16, gap: 12, paddingBottom: 8 },
  bubble:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, maxWidth: '90%' },
  bubbleAI:     { alignSelf: 'flex-start' },
  bubbleUser:   { alignSelf: 'flex-end', flexDirection: 'row-reverse', maxWidth: '80%' },
  aiMark:       { width: 28, height: 28, borderRadius: 9, backgroundColor: COLORS.accent + '25', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  aiMarkTxt:    { fontSize: 12, color: COLORS.accent },
  bubbleText:   { fontSize: 14, color: COLORS.text1, lineHeight: 21, backgroundColor: COLORS.bg3, borderRadius: 16, borderTopLeftRadius: 4, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  bubbleTextUser:{ backgroundColor: COLORS.accent, color: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 4, borderColor: 'transparent' },
  saveTaskBtn:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, paddingLeft: 2 },
  saveTaskTxt:  { fontSize: 12, color: COLORS.accent, fontWeight: '600' },
  typingRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 4 },

  // Chips
  chipsWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  chip:         { backgroundColor: COLORS.bg3, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border },
  chipTxt:      { fontSize: 13, fontWeight: '600', color: COLORS.text2 },

  // Input
  inputWrap:    { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, paddingTop: 8, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  input:        { flex: 1, backgroundColor: COLORS.bg3, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: COLORS.text1, borderWidth: 1, borderColor: COLORS.border, maxHeight: 120 },
  sendBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnOff:   { backgroundColor: COLORS.muted },
});
