import React, { useState, useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Compass, Play, Users, User, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { isFeatureActive } from '@/lib/featureFlags';

export default function TabLayout() {
  const [worldCupEnabled, setWorldCupEnabled] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    isFeatureActive('world_cup_mode', { ignoreDateWindow: true }).then(setWorldCupEnabled).catch(() => setWorldCupEnabled(true));
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.dark.accent,
        tabBarInactiveTintColor: Colors.dark.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.dark.tabBar,
          borderTopColor: Colors.dark.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: Colors.dark.background,
        },
        headerTintColor: Colors.dark.text,
        headerShadowVisible: false,
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => <Compass size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="clips"
        options={{
          title: 'Clips',
          tabBarIcon: ({ color, size }) => <Play size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="world-cup"
        options={{
          title: 'Soccer Cup',
          href: worldCupEnabled ? '/world-cup' : null,
          tabBarIcon: ({ size, focused }) => (
            <Trophy
              size={size}
              color={focused ? Colors.dark.accentGreen : Colors.dark.textMuted}
            />
          ),
          tabBarActiveTintColor: Colors.dark.accentGreen,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
