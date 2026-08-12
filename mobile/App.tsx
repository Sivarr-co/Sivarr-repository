import React, { useEffect } from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import TodayScreen from './src/screens/TodayScreen';
import AIScreen    from './src/screens/AIScreen';
import MeScreen    from './src/screens/MeScreen';
import LoginScreen from './src/screens/LoginScreen';
import MoreScreen  from './src/screens/MoreScreen';

// Previously built, fully wired to the backend, but never imported anywhere —
// only reachable now via the "More" tab below.
import GoalsScreen        from './src/screens/GoalsScreen';
import HabitsScreen       from './src/screens/HabitsScreen';
import JournalScreen      from './src/screens/JournalScreen';
import FocusScreen        from './src/screens/FocusScreen';
import CommunityScreen    from './src/screens/CommunityScreen';
import WeeklyReviewScreen from './src/screens/WeeklyReviewScreen';
import SettingsScreen     from './src/screens/SettingsScreen';

import { useAuth } from './src/hooks/useAuth';
import { COLORS }  from './src/theme';
import {
  configureNotificationHandler,
  requestNotificationPermission,
  scheduleDailyBrief,
  scheduleHabitReminder,
} from './src/services/notifications';

// Prevent OS accessibility font-size from stretching/compressing all text.
// This mutates RN's own Text/TextInput (class-based components maintained by
// React Native, not plain function components defined in this codebase) —
// so it isn't affected by React 19 dropping defaultProps support for function
// components, and is the standard RN-ecosystem idiom for this exact use case.
// Verified safe as-is rather than changed for the sake of it.
if (Text.defaultProps == null) (Text as any).defaultProps = {};
(Text as any).defaultProps.allowFontScaling = false;
if (TextInput.defaultProps == null) (TextInput as any).defaultProps = {};
(TextInput as any).defaultProps.allowFontScaling = false;

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// ── AI tab icon — glowing orb when active ─────────────────────
function AITabIcon({ color, focused }: { color: string; focused: boolean }) {
  return (
    <View style={[styles.aiIcon, focused && styles.aiIconActive]}>
      <Ionicons name="sparkles" size={focused ? 19 : 17} color={focused ? '#fff' : color} />
    </View>
  );
}

// ── 3-tab navigator ───────────────────────────────────────────
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.bg2,
          borderTopWidth: 1,
          borderTopColor: COLORS.border,
          height: 64,
          paddingBottom: 10,
          paddingTop: 6,
        },
        tabBarActiveTintColor:   COLORS.accent,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{
          tabBarLabel: 'Today',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="sunny-outline" size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="AI"
        component={AIScreen}
        options={{
          tabBarLabel: 'SIVARR AI',
          tabBarIcon: ({ color, focused }) => (
            <AITabIcon color={color} focused={focused} />
          ),
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700', color: COLORS.accent },
        }}
      />

      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{
          tabBarLabel: 'Me',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          tabBarLabel: 'More',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// Screens reached from the "More" tab (see MoreScreen.tsx). Registered
// alongside "Main" in the root stack (not nested inside the tab navigator)
// so they push on top of the tab bar the same way any "detail" screen would.
// The root Stack.Navigator sets headerShown:false globally and none of these
// screens implement their own back button, so each one gets its header
// re-enabled here specifically — that's what actually gives the user a way
// back (previously would have relied on iOS edge-swipe / Android hardware
// back only).
const MORE_SCREENS: { name: string; component: React.ComponentType<any>; title: string }[] = [
  { name: 'WeeklyReview', component: WeeklyReviewScreen, title: 'Weekly Review' },
  { name: 'Focus',        component: FocusScreen,        title: 'Focus' },
  { name: 'Goals',        component: GoalsScreen,         title: 'Goals' },
  { name: 'Habits',       component: HabitsScreen,        title: 'Habits' },
  { name: 'Journal',      component: JournalScreen,       title: 'Journal' },
  { name: 'Community',    component: CommunityScreen,     title: 'Community' },
  { name: 'Settings',     component: SettingsScreen,      title: 'Settings' },
];

// ── Root ──────────────────────────────────────────────────────
export default function App() {
  const { isLoggedIn } = useAuth();

  useEffect(() => {
    configureNotificationHandler();
    if (isLoggedIn) {
      requestNotificationPermission().then(granted => {
        if (granted) {
          scheduleDailyBrief(8, 0);      // 8am daily brief
          scheduleHabitReminder(20, 0);  // 8pm habit check
        }
      });
    }
  }, [isLoggedIn]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={COLORS.bg} />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
          {isLoggedIn ? (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              {MORE_SCREENS.map(({ name, component, title }) => (
                <Stack.Screen
                  key={name}
                  name={name}
                  component={component}
                  options={{
                    headerShown: true,
                    title,
                    headerStyle: { backgroundColor: COLORS.bg2 },
                    headerTintColor: COLORS.text1,
                    headerShadowVisible: false,
                    animation: 'slide_from_right',
                  }}
                />
              ))}
            </>
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  aiIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  aiIconActive: {
    backgroundColor: COLORS.accent,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
});
