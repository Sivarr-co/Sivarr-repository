import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api }    from '../api/client';
import { COLORS } from '../theme';

type Post = { id: string; author: string; body: string; category: string; likes: string[]; replies: any[]; created: string };

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

export default function CommunityScreen() {
  const [posts,      setPosts]  = useState<Post[]>([]);
  const [refreshing, setRefr]   = useState(false);
  const [postInput,  setPostInput] = useState('');
  const [posting,    setPosting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const d = await api.communityPosts();
      setPosts(d.posts ?? []);
    } catch(_) {}
  }

  async function onRefresh() {
    setRefr(true);
    await load();
    setRefr(false);
  }

  async function submitPost() {
    if (!postInput.trim()) return;
    setPosting(true);
    try {
      await api.communityPost(postInput.trim(), 'general');
      setPostInput('');
      load();
    } catch(e: any) { Alert.alert('Error', e.message); }
    finally { setPosting(false); }
  }

  async function like(id: string) {
    try {
      await api.communityLike(id);
      load();
    } catch(_) {}
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>Community</Text>
        <Text style={s.sub}>Connect with peers, share knowledge</Text>
      </View>

      {/* Post composer */}
      <View style={s.composer}>
        <TextInput
          style={s.composerInput}
          placeholder="Share something with the community…"
          placeholderTextColor={COLORS.muted}
          value={postInput}
          onChangeText={setPostInput}
          multiline
        />
        <TouchableOpacity style={[s.postBtn, !postInput.trim() && { opacity: 0.5 }]} onPress={submitPost} disabled={posting || !postInput.trim()}>
          <Text style={s.postBtnTxt}>Post</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        renderItem={({ item: p }) => (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.av}><Text style={s.avTxt}>{(p.author?.[0] ?? 'U').toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.author}>{p.author}</Text>
                <Text style={s.time}>{timeAgo(p.created)}</Text>
              </View>
            </View>
            <Text style={s.body}>{p.body}</Text>
            <View style={s.actions}>
              <TouchableOpacity style={s.actionBtn} onPress={() => like(p.id)}>
                <Text style={s.actionTxt}>♥ {(p.likes ?? []).length}</Text>
              </TouchableOpacity>
              <Text style={s.actionTxt}>💬 {(p.replies ?? []).length}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No posts yet. Be the first to share!</Text>}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: COLORS.bg },
  header:       { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: COLORS.border },
  title:        { fontWeight: '800', fontSize: 18, color: COLORS.text1 },
  sub:          { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  composer:     { margin: 12, backgroundColor: COLORS.bg3, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  composerInput:{ color: COLORS.text1, fontSize: 14, minHeight: 60, textAlignVertical: 'top' },
  postBtn:      { alignSelf: 'flex-end', backgroundColor: COLORS.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, marginTop: 6 },
  postBtnTxt:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  card:         { backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  cardHeader:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  av:           { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.accent+'33', alignItems: 'center', justifyContent: 'center' },
  avTxt:        { fontWeight: '800', fontSize: 14, color: COLORS.accent },
  author:       { fontWeight: '700', fontSize: 13, color: COLORS.text1 },
  time:         { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  body:         { fontSize: 14, color: COLORS.text2, lineHeight: 21 },
  actions:      { flexDirection: 'row', gap: 16, marginTop: 10 },
  actionBtn:    { flexDirection: 'row', alignItems: 'center' },
  actionTxt:    { fontSize: 13, color: COLORS.muted, fontWeight: '600' },
  empty:        { textAlign: 'center', color: COLORS.muted, paddingTop: 60, fontSize: 14 },
});
