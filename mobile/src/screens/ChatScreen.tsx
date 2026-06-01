import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api }    from '../api/client';
import { COLORS } from '../theme';

type Msg = { role: 'user' | 'ai'; text: string };

export default function ChatScreen() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'ai', text: 'Hi! I\'m SIVARR AI. How can I help you today?' },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoad]    = useState(false);
  const listRef               = useRef<FlatList>(null);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMsg: Msg = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setLoad(true);
    try {
      const d = await api.aiChat(text);
      const aiMsg: Msg = { role: 'ai', text: d.response ?? d.answer ?? 'Hmm, let me think about that.' };
      setMessages(prev => [...prev, aiMsg]);
    } catch(e: any) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Something went wrong. Try again.' }]);
    } finally {
      setLoad(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>SIVARR AI</Text>
        <Text style={s.sub}>Your intelligent workspace assistant</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={s.list}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.role === 'user' ? s.userBubble : s.aiBubble]}>
            <Text style={[s.bubbleTxt, item.role === 'user' ? s.userTxt : s.aiTxt]}>
              {item.text}
            </Text>
          </View>
        )}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      />

      {loading && (
        <View style={s.typing}>
          <ActivityIndicator size="small" color={COLORS.accent} />
          <Text style={s.typingTxt}>SIVARR is thinking…</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder="Ask anything…"
            placeholderTextColor={COLORS.muted}
            value={input}
            onChangeText={setInput}
            multiline
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <TouchableOpacity style={s.sendBtn} onPress={send} disabled={loading || !input.trim()}>
            <Text style={s.sendTxt}>→</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: COLORS.bg },
  header:     { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: COLORS.border },
  title:      { fontWeight: '800', fontSize: 18, color: COLORS.text1 },
  sub:        { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  list:       { padding: 16, gap: 10 },
  bubble:     { maxWidth: '80%', borderRadius: 14, padding: 12 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: COLORS.accent },
  aiBubble:   { alignSelf: 'flex-start', backgroundColor: COLORS.bg3, borderWidth: 1, borderColor: COLORS.border },
  bubbleTxt:  { fontSize: 14, lineHeight: 21 },
  userTxt:    { color: '#fff' },
  aiTxt:      { color: COLORS.text1 },
  typing:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
  typingTxt:  { fontSize: 12, color: COLORS.muted },
  inputRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderColor: COLORS.border },
  input:      { flex: 1, backgroundColor: COLORS.bg3, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
                color: COLORS.text1, fontSize: 14, maxHeight: 120, borderWidth: 1, borderColor: COLORS.border },
  sendBtn:    { width: 42, height: 42, borderRadius: 12, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  sendTxt:    { color: '#fff', fontSize: 18, fontWeight: '700' },
});
