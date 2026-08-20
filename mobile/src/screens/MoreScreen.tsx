import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { COLORS } from '../theme';

type NavItem = {
  icon:  keyof typeof Ionicons.glyphMap;
  label: string;
  sub:   string;
  screen: string;
  color?: string;
};

const ITEMS: NavItem[] = [
  { icon: 'calendar-outline',  label: 'Weekly Review', sub: 'SIVA reflects on your week',    screen: 'WeeklyReview' },
  { icon: 'timer-outline',     label: 'Focus',         sub: 'Pomodoro timer & sessions',     screen: 'Focus'        },
  { icon: 'trophy-outline',    label: 'Goals',         sub: 'Track your targets',            screen: 'Goals'        },
  { icon: 'today-outline',     label: 'Calendar',      sub: 'Tasks and goal deadlines',      screen: 'Calendar'     },
  { icon: 'flame-outline',     label: 'Habits',        sub: 'Daily habit tracker',           screen: 'Habits'       },
  { icon: 'journal-outline',   label: 'Journal',       sub: 'Reflect and write daily',       screen: 'Journal'      },
  { icon: 'people-outline',    label: 'Community',     sub: 'Connect with peers',            screen: 'Community'    },
  { icon: 'business-outline',  label: 'Organisation',  sub: 'Team tasks, goals, docs',        screen: 'Org'          },
  { icon: 'notifications-outline', label: 'Notifications', sub: 'Assignments, invites, updates', screen: 'Notifications' },
  { icon: 'settings-outline',  label: 'Settings',      sub: 'Billing, account, sign out',    screen: 'Settings'     },
];

export default function MoreScreen({ navigation }: { navigation: any }) {
  const [unread, setUnread] = useState(0);

  // Refetch on every focus (not just mount) so the badge clears after a
  // visit to the Notifications screen without needing shared state — no
  // cross-screen store exists in this app (see api/client.ts's own note on
  // that), so each screen just asks the server itself.
  useFocusEffect(
    React.useCallback(() => {
      let live = true;
      api.notifications().then(d => { if (live) setUnread(d.unread ?? 0); }).catch(() => {});
      return () => { live = false; };
    }, []),
  );

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>More</Text>
        {ITEMS.map(item => (
          <TouchableOpacity key={item.screen} style={s.row} onPress={() => navigation.navigate(item.screen)} activeOpacity={0.7}>
            <View style={s.iconWrap}>
              <Ionicons name={item.icon} size={22} color={item.color ?? COLORS.accent} />
            </View>
            <View style={s.rowText}>
              <Text style={s.rowLabel}>{item.label}</Text>
              <Text style={s.rowSub}>{item.sub}</Text>
            </View>
            {item.screen === 'Notifications' && unread > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeTxt}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: COLORS.bg },
  content:  { padding: 16, gap: 8 },
  title:    { fontWeight: '800', fontSize: 22, color: COLORS.text1, letterSpacing: -0.5, marginBottom: 12 },
  row:      { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bg3, borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: COLORS.border },
  iconWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.accent + '18', alignItems: 'center', justifyContent: 'center' },
  rowText:  { flex: 1 },
  rowLabel: { fontWeight: '700', fontSize: 15, color: COLORS.text1 },
  rowSub:   { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  badge:    { backgroundColor: COLORS.red, borderRadius: 9, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
