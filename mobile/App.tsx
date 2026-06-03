import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import TodayScreen     from './src/screens/TodayScreen';
import AIScreen        from './src/screens/AIScreen';
import TasksScreen     from './src/screens/TasksScreen';
import MeScreen        from './src/screens/MeScreen';
import GoalsScreen     from './src/screens/GoalsScreen';
import HabitsScreen    from './src/screens/HabitsScreen';
import JournalScreen   from './src/screens/JournalScreen';
import CommunityScreen from './src/screens/CommunityScreen';
import SettingsScreen  from './src/screens/SettingsScreen';
import LoginScreen     from './src/screens/LoginScreen';
import MoreScreen      from './src/screens/MoreScreen';

import { useAuth } from './src/hooks/useAuth';
import { COLORS }  from './src/theme';

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_OPTS = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: COLORS.bg2,
    borderTopColor: COLORS.border,
    height: 60,
    paddingBottom: 8,
    paddingTop: 4,
  },
  tabBarActiveTintColor:   COLORS.accent,
  tabBarInactiveTintColor: COLORS.muted,
  tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const },
};

// Stack inside "More" tab
function MoreStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MoreHome"  component={MoreScreen} />
      <Stack.Screen name="Goals"     component={GoalsScreen} />
      <Stack.Screen name="Habits"    component={HabitsScreen} />
      <Stack.Screen name="Journal"   component={JournalScreen} />
      <Stack.Screen name="Community" component={CommunityScreen} />
      <Stack.Screen name="Settings"  component={SettingsScreen} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={TAB_OPTS}>
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{
          tabBarLabel: 'Today',
          tabBarIcon: ({ color, size }) => <Ionicons name="today-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="AI"
        component={AIScreen}
        options={{
          tabBarLabel: 'SIVARR AI',
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Tasks"
        component={TasksScreen}
        options={{
          tabBarLabel: 'Tasks',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{
          tabBarLabel: 'Me',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreStack}
        options={{
          tabBarLabel: 'More',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const { isLoggedIn } = useAuth();

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
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
