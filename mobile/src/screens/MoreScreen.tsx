import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

type NavItem = {
  icon:  keyof typeof Ionicons.glyphMap;
  label: string;
  sub:   string;
  screen: string;
  color?: string;
};

const ITEMS: NavItem[] = [
  { icon: 'flame-outline',     label: 'Habits',      sub: 'Daily habit tracker',        screen: 'Habits'    },
  { icon: 'journal-outline',   label: 'Journal',     sub: 'Reflect and write daily',    screen: 'Journal'   },
  { icon: 'people-outline',    label: 'Community',   sub: 'Connect with peers',         screen: 'Community' },
  { icon: 'settings-outline',  label: 'Settings',    sub: 'Billing, account, sign out', screen: 'Settings'  },
];

export default function MoreScreen({ navigation }: { navigation: any }) {
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
});
