import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import HomeScreen       from './src/screens/HomeScreen';
import ChatScreen       from './src/screens/ChatScreen';
import TasksScreen      from './src/screens/TasksScreen';
import CommunityScreen  from './src/screens/CommunityScreen';
import SettingsScreen   from './src/screens/SettingsScreen';
import LoginScreen      from './src/screens/LoginScreen';

import { useAuth }      from './src/hooks/useAuth';
import { COLORS }       from './src/theme';

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.bg,
          borderTopColor: COLORS.border,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor:   COLORS.accent,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen name="Home"      component={HomeScreen}      options={{ tabBarLabel:'Home',      tabBarIcon: () => null }} />
      <Tab.Screen name="Chat"      component={ChatScreen}      options={{ tabBarLabel:'SIVARR AI', tabBarIcon: () => null }} />
      <Tab.Screen name="Tasks"     component={TasksScreen}     options={{ tabBarLabel:'Tasks',     tabBarIcon: () => null }} />
      <Tab.Screen name="Community" component={CommunityScreen} options={{ tabBarLabel:'Community', tabBarIcon: () => null }} />
      <Tab.Screen name="Settings"  component={SettingsScreen}  options={{ tabBarLabel:'Settings',  tabBarIcon: () => null }} />
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
