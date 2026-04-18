import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Star } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { WCSchedule } from '@/components/WCSchedule';
import { WCTeamFollowModal } from '@/components/WCTeamFollowModal';
import WCWatchParties from '@/components/WCWatchParties';
import WCFanGroups from '@/components/WCFanGroups';

const GREEN_ACCENT = Colors.dark.accentGreen; // #00c853
const GREEN_DARK = Colors.dark.accentGreenDark; // #004d25

type SubTab = 'schedule' | 'watchParties' | 'fanGroups';

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------
export default function WorldCupScreen() {
  const [activeTab, setActiveTab] = useState<SubTab>('schedule');
  const [teamFollowVisible, setTeamFollowVisible] = useState(false);

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'schedule', label: 'Schedule' },
    { key: 'watchParties', label: 'Watch Parties' },
    { key: 'fanGroups', label: 'Fan Groups' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'schedule':
        return <WCSchedule />;
      case 'watchParties':
        return <WCWatchParties />;
      case 'fanGroups':
        return <WCFanGroups />;
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Green gradient header */}
      <LinearGradient
        colors={[GREEN_DARK, GREEN_ACCENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>World Cup 2026</Text>
            <Text style={styles.headerSubtitle}>
              USA &middot; Canada &middot; Mexico &middot; June 11 - July 19
            </Text>
          </View>
          <TouchableOpacity
            style={styles.starButton}
            onPress={() => setTeamFollowVisible(true)}
            activeOpacity={0.7}
          >
            <Star size={22} color="#fff" fill="#fff" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Sub-tab row */}
      <View style={styles.tabRow}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tabItem,
              activeTab === tab.key && styles.tabItemActive,
            ]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === tab.key && styles.tabLabelActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <View style={styles.content}>{renderContent()}</View>

      {/* Team Follow Modal */}
      <WCTeamFollowModal
        visible={teamFollowVisible}
        onClose={() => setTeamFollowVisible(false)}
        onUpdate={() => {}}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  // Header
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  starButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sub-tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: GREEN_ACCENT,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  tabLabelActive: {
    color: GREEN_ACCENT,
  },
  // Content
  content: {
    flex: 1,
  },
});
