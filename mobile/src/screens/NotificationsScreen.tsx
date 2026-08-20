import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { COLORS } from '../theme';

// Server-driven notification history — see app.py's `notifications` table
// and send_push(). Distinct from the two local scheduled reminders (daily
// brief, habit check-in) configured in services/notifications.ts, which
// never touch the server at all.

type Notification = {
  id: string; title: string; body: string; url: string;
  read_at: string | null; created_at: string;
};

export default function NotificationsScreen() {
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items,      setItems]      = useState<Notification[]>([]);
  const [unread,     setUnread]     = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await api.notifications();
      setItems(d.notifications ?? []);
      setUnread(d.unread ?? 0);
    } catch (_) {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markRead(n: Notification) {
    if (n.read_at) return;
    setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
    setUnread(prev => Math.max(0, prev - 1));
    try { await api.notificationMarkRead(n.id); } catch (_) {}
  }

  async function markAllRead() {
    if (!unread) return;
    setItems(prev => prev.map(x => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
    try { await api.notificationMarkAllRead(); } catch (_) {}
  }

  if (loading) return (
    <SafeAreaView style={s.root}>
      <ActivityIndicator color={COLORS.accent} style={{ marginTop: 80 }} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.root}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.accent} />}
      >
        <View style={s.header}>
          <Text style={s.title}>Notifications</Text>
          {unread > 0 && (
            <TouchableOpacity onPress={markAllRead}>
              <Text style={s.markAll}>Mark all read</Text>
            </TouchableOpacity>
          )}
        </View>

        {!items.length && (
          <View style={s.empty}>
            <Ionicons name="notifications-off-outline" size={36} color={COLORS.muted} style={{ marginBottom: 10 }} />
            <Text style={s.emptyTitle}>No notifications yet</Text>
            <Text style={s.emptyText}>Task assignments, org invites, and other updates will show up here.</Text>
          </View>
        )}

        {items.map(n => (
          <TouchableOpacity
            key={n.id}
            style={[s.row, !n.read_at && s.rowUnread]}
            onPress={() => markRead(n)}
            activeOpacity={0.7}
          >
            {!n.read_at && <View style={s.dot} />}
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{n.title}</Text>
              {!!n.body && <Text style={s.rowBody} numberOfLines={2}>{n.body}</Text>}
              <Text style={s.rowTime}>{timeAgo(n.created_at)}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: COLORS.bg },
  content:    { padding: 16, gap: 8 },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title:      { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5 },
  markAll:    { fontSize: 13, fontWeight: '700', color: COLORS.accent },
  empty:      { alignItems: 'center', paddingVertical: 50 },
  emptyTitle: { fontWeight: '700', fontSize: 16, color: COLORS.text1, marginBottom: 6 },
  emptyText:  { fontSize: 13, color: COLORS.muted, textAlign: 'center', lineHeight: 19, maxWidth: 260 },
  row:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: COLORS.bg3, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  rowUnread:  { borderColor: COLORS.accent + '50' },
  dot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent, marginTop: 5 },
  rowTitle:   { fontSize: 14, fontWeight: '700', color: COLORS.text1 },
  rowBody:    { fontSize: 13, color: COLORS.text2, marginTop: 3, lineHeight: 18 },
  rowTime:    { fontSize: 11, color: COLORS.muted, marginTop: 6 },
});
