import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Star,
  Ticket,
  Video,
  MapPin,
  Plane,
  Bell,
  Settings,
  LogOut,
  ChevronRight,
  Edit3,
  BarChart3,
  Share2,
  Trophy,
  Shield,
  ScrollText,
  Slash,
  Trash2,
  Crown,
} from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useSubscriptionState } from '@/lib/entitlements';

export default function ProfileScreen() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState({ groups: 0, parties: 0, clips: 0 });
  const [followedTeams, setFollowedTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [homeCity, setHomeCity] = useState('');
  // Drives the Subscription menu badge so free users see a "Free · Upgrade"
  // call-out instead of just "Subscription" — without this entry point a
  // fresh sign-in never finds the PremiumPaywall / WCPassPaywall after the
  // v7 cleanup removed in-line PaywallGates.
  const { data: subState } = useSubscriptionState();

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        setLoading(false);
        return;
      }

      // Fetch user profile from users table
      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', user.id)
        .single();

      if (profileData && !profileError) {
        setProfile(profileData);
        setIsAdmin(profileData.is_admin === true);
        if (profileData.home_city) {
          setHomeCity(profileData.home_city);
        }
      }

      // Fetch stats: group count
      const { count: groupCount } = await supabase
        .from('chat_room_members')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profileData?.id || user.id);

      // Fetch stats: party RSVP count
      const { count: partyCount } = await supabase
        .from('watch_party_rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profileData?.id || user.id);

      // Fetch stats: clips count
      const { count: clipCount } = await supabase
        .from('media_clips')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profileData?.id || user.id);

      setStats({
        groups: groupCount || 0,
        parties: partyCount || 0,
        clips: clipCount || 0,
      });

      // Fetch followed teams
      if (profileData?.favorite_team_ids && profileData.favorite_team_ids.length > 0) {
        const { data: teamsData } = await supabase
          .from('teams')
          .select('name')
          .in('id', profileData.favorite_team_ids);

        if (teamsData && teamsData.length > 0) {
          setFollowedTeams(teamsData.map((t: any) => t.name));
        }
      }

      // Load city from AsyncStorage as fallback
      if (!profileData?.home_city) {
        const storedCity = await AsyncStorage.getItem('user_city');
        if (storedCity) setHomeCity(storedCity);
      }
    } catch {
      // Load city from storage as fallback
      const storedCity = await AsyncStorage.getItem('user_city');
      if (storedCity) setHomeCity(storedCity);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            await AsyncStorage.removeItem('onboarding_complete');
            await AsyncStorage.removeItem('user_city');
            router.replace('/(auth)/sign-in');
          },
        },
      ],
    );
  };

  const handleMenuPress = (label: string) => {
    if (label === 'My Sports') {
      router.push('/(auth)/onboarding-sports' as any);
    } else if (label === 'My Teams') {
      router.push('/my-teams' as any);
    } else if (label === 'My Clips') {
      router.push('/my-clips' as any);
    } else if (label === 'RSVP History') {
      router.push('/rsvp-history' as any);
    } else if (label === 'Notifications') {
      router.push('/notification-settings' as any);
    } else if (label === 'Edit Profile') {
      router.push('/edit-profile' as any);
    } else if (label === 'My Stats') {
      router.push('/creator-stats' as any);
    } else if (label === 'Subscription') {
      router.push('/subscription' as any);
    } else if (label === 'Invite Friends') {
      handleInvite();
    } else if (label === 'Privacy Policy') {
      router.push('/legal/privacy' as any);
    } else if (label === 'Terms of Service') {
      router.push('/legal/terms' as any);
    } else if (label === 'Blocked Users') {
      router.push('/blocked-users' as any);
    } else if (label === 'Sign Out') {
      handleSignOut();
    } else if (label === 'Delete Account') {
      router.push('/delete-account' as any);
    }
  };

  const handleInvite = async () => {
    try {
      const { shareAppInvite } = await import('@/lib/sharing');
      const { data } = await supabase.rpc('get_my_referral_code');
      await shareAppInvite(data ?? undefined);
    } catch {
      const { shareAppInvite } = await import('@/lib/sharing');
      await shareAppInvite();
    }
  };

  const displayName = profile?.display_name || 'Fan Sphere User';
  const handle = profile?.email
    ? `@${profile.email.split('@')[0]}`
    : '';

  // Subscription badge text — drives the upgrade CTA so fresh free users
  // can find PremiumPaywall / WCPassPaywall without trial-and-error after
  // v7 dropped the in-line PaywallGates.
  const hasPremium = subState?.hasPremiumAccess ?? false;
  const hasWC = subState?.hasWCAccess ?? false;
  const subBadge = hasPremium
    ? (subState?.isTrial ? 'Trial' : 'Premium')
    : hasWC
      ? 'Soccer Cup Pass'
      : 'Free · Upgrade';

  const menuItems = [
    { icon: Edit3, label: 'Edit Profile', color: Colors.dark.text, badge: null as string | null },
    { icon: Crown, label: 'Subscription', color: Colors.dark.accent, badge: subBadge },
    { icon: Trophy, label: 'My Sports', color: Colors.dark.text, badge: null },
    { icon: Star, label: 'My Teams', color: Colors.dark.text, badge: null },
    { icon: Ticket, label: 'RSVP History', color: Colors.dark.text, badge: null },
    { icon: Video, label: 'My Clips', color: Colors.dark.text, badge: null },
    { icon: BarChart3, label: 'My Stats', color: Colors.dark.text, badge: null },
    { icon: Bell, label: 'Notifications', color: Colors.dark.text, badge: null },
    { icon: Share2, label: 'Invite Friends', color: Colors.dark.accent, badge: null },
    { icon: Slash, label: 'Blocked Users', color: Colors.dark.text, badge: null },
    { icon: Shield, label: 'Privacy Policy', color: Colors.dark.text, badge: null },
    { icon: ScrollText, label: 'Terms of Service', color: Colors.dark.text, badge: null },
    { icon: LogOut, label: 'Sign Out', color: Colors.dark.error, badge: null },
    { icon: Trash2, label: 'Delete Account', color: Colors.dark.error, badge: null },
  ];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>👤</Text>
          </View>
          <Text style={styles.name}>{displayName}</Text>
          {handle ? <Text style={styles.handle}>{handle}</Text> : null}

          <TouchableOpacity
            style={styles.editProfileButton}
            onPress={() => router.push('/edit-profile' as any)}
          >
            <Edit3 size={14} color={Colors.dark.accent} />
            <Text style={styles.editProfileText}>Edit Profile</Text>
          </TouchableOpacity>

          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{stats.groups}</Text>
              <Text style={styles.statLabel}>Groups</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{stats.parties}</Text>
              <Text style={styles.statLabel}>Parties</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{stats.clips}</Text>
              <Text style={styles.statLabel}>Clips</Text>
            </View>
          </View>

          {followedTeams.length > 0 && (
            <View style={styles.teamRow}>
              {followedTeams.map((team) => (
                <View key={team} style={styles.teamBadge}>
                  <Text style={styles.teamBadgeText}>{team}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {menuItems.map((item) => {
          const isUpgradeBadge =
            item.label === 'Subscription' && !hasPremium && !hasWC;
          return (
            <TouchableOpacity
              key={item.label}
              style={styles.menuItem}
              onPress={() => handleMenuPress(item.label)}
            >
              <item.icon size={20} color={item.color} />
              <Text style={[styles.menuLabel, { color: item.color }]}>
                {item.label}
              </Text>
              {item.badge ? (
                <View
                  style={[
                    styles.badge,
                    isUpgradeBadge && styles.badgeUpgrade,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      isUpgradeBadge && styles.badgeTextUpgrade,
                    ]}
                  >
                    {item.badge}
                  </Text>
                </View>
              ) : null}
              <ChevronRight size={18} color={Colors.dark.textMuted} />
            </TouchableOpacity>
          );
        })}

        {isAdmin && (
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.push('/(admin)' as any)}
          >
            <Shield size={20} color={Colors.dark.accent} />
            <Text style={[styles.menuLabel, { color: Colors.dark.accent }]}>
              Admin Dashboard
            </Text>
            <ChevronRight size={18} color={Colors.dark.accent} />
          </TouchableOpacity>
        )}

        <View style={styles.spacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: Colors.dark.accent,
  },
  avatarText: {
    fontSize: 32,
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  handle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  editProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  editProfileText: {
    fontSize: 13,
    color: Colors.dark.accent,
    fontWeight: '600',
  },
  stats: {
    flexDirection: 'row',
    gap: 32,
    marginTop: 16,
  },
  stat: {
    alignItems: 'center',
  },
  statNum: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  teamRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  teamBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  teamBadgeText: {
    fontSize: 13,
    color: Colors.dark.text,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.surface,
    gap: 14,
  },
  menuLabel: {
    fontSize: 15,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  badgeUpgrade: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
  },
  badgeTextUpgrade: {
    color: '#fff',
  },
  spacer: {
    height: 40,
  },
});
