import React, { useEffect } from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';

// Prevent OS accessibility font-size from stretching/compressing all text
if (Text.defaultProps == null) (Text as any).defaultProps = {};
(Text as any).defaultProps.allowFontScaling = false;
if (TextInput.defaultProps == null) (TextInput as any).defaultProps = {};
(TextInput as any).defaultProps.allowFontScaling = false;
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import TodayScreen from './src/screens/TodayScreen';
import AIScreen    from './src/screens/AIScreen';
import MeScreen    from './src/screens/MeScreen';
import LoginScreen from './src/screens/LoginScreen';

import { useAuth } from './src/hooks/useAuth';
import { COLORS }  from './src/theme';
import {
  configureNotificationHandler,
  requestNotificationPermission,
  scheduleDailyBrief,
  scheduleHabitReminder,
} from './src/services/notifications';

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
    </Tab.Navigator>
  );
}

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
            <Stack.Screen name="Main" component={MainTabs} />
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
