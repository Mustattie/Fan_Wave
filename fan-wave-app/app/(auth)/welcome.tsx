import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
  ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface WelcomeSlide {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  accent: string;
}

const SLIDES: WelcomeSlide[] = [
  {
    id: '1',
    emoji: '👥🏟️🌊',
    title: 'Your crew,\nany city,\nevery game.',
    subtitle: 'Find your people wherever sports take you. Join fan groups, chat live, and never watch alone.',
    accent: Colors.dark.accent,
  },
  {
    id: '2',
    emoji: '🍺📍🎉',
    title: 'Watch parties\neverywhere.',
    subtitle: 'Discover the best spots to watch the game. RSVP, invite friends, and rally your crew.',
    accent: '#ff8c00',
  },
  {
    id: '3',
    emoji: '🎬🔥⚡',
    title: 'Capture\nthe moment.',
    subtitle: 'Post highlights, react to big plays, and share the energy. Your game-day highlight reel.',
    accent: '#00c853',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
  ).current;

  const viewConfigRef = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleGetStarted = useCallback(async () => {
    await AsyncStorage.setItem('has_seen_welcome', 'true');
    router.replace('/(auth)/sign-up');
  }, [router]);

  const handleSignIn = useCallback(async () => {
    await AsyncStorage.setItem('has_seen_welcome', 'true');
    router.replace('/(auth)/sign-in');
  }, [router]);

  const handleNext = useCallback(() => {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      handleGetStarted();
    }
  }, [activeIndex, handleGetStarted]);

  const renderSlide = ({ item }: { item: WelcomeSlide }) => (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <Text style={styles.slideEmoji}>{item.emoji}</Text>
      <Text style={[styles.slideTitle, { color: item.accent }]}>{item.title}</Text>
      <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
    </View>
  );

  const isLast = activeIndex === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>Fan Wave</Text>
        <Text style={styles.wave}>🌊</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewConfigRef}
        bounces={false}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === activeIndex ? styles.dotActive : styles.dotInactive,
            ]}
          />
        ))}
      </View>

      {/* Buttons */}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: SLIDES[activeIndex].accent }]}
          onPress={handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>
            {isLast ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSignIn} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>Already have an account? Sign In</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 24,
    paddingBottom: 8,
  },
  logo: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.dark.text,
    letterSpacing: -1,
  },
  wave: {
    fontSize: 28,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  slideEmoji: {
    fontSize: 56,
    marginBottom: 24,
    letterSpacing: 8,
  },
  slideTitle: {
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 42,
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  slideSubtitle: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: Colors.dark.text,
    width: 24,
  },
  dotInactive: {
    backgroundColor: Colors.dark.surfaceLight,
  },
  buttons: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 12,
  },
  primaryBtn: {
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#fff',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
});
