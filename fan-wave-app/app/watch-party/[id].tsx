import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  Share,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Share2,
  MapPin,
  MessageCircle,
  Flag,
  Lock,
  Globe,
  Slash,
} from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { TierBadge } from '@/components/TierBadge';
import { subscribeToRsvpCounts } from '@/lib/realtime';
import { getSportEmoji, getSportColor, formatFullDate } from '@/lib/mappers';
import { reportError } from '@/lib/errorReporting';
import { blockUser } from '@/lib/blocks';
import { WCPassPaywall } from '@/components/paywall/WCPassPaywall';
import { WC_EVENT_ID } from '@/constants/WorldCupIds';

type RsvpStatus = 'going' | 'interested' | 'cant_go' | null;

interface Attendee {
  id: string;
  name: string;
  initial: string;
  avatarBg: string;
  status: 'going' | 'interested' | 'cant_go';
  /** v9.5: hydrated from get_public_profiles so paid tiers carry their
   *  badge into the guest list. Undefined renders nothing. */
  tier?: string;
  userId?: string;
}

// v9.4.0 UAT Round 3 (#6, #9): totals used to render the "N going · N
// maybe · N can't go" summary line and the per-status host sections.
interface AttendeeTotals {
  going: number;
  maybe: number;
  cantGo: number;
}

interface GroupAffinity {
  groupId: string;
  groupName: string;
  goingCount: number;
  // v9.4.3: unique people across ALL the viewer's groups (mig 085). Same
  // value on every row -- one fan in three shared groups is 1 here and 3
  // across the goingCount fields.
  distinctFans: number;
}

interface WatchPartyDetail {
  id: string;
  title: string;
  sport: string;
  sportEmoji: string;
  sportColor: string;
  venue_name: string;
  venue_address: string;
  venue_area: string;
  latitude: number;
  longitude: number;
  date: string;
  time: string;
  atmosphere: string;
  description: string;
  capacity: number;
  rsvp_count: number;
  creator_id: string | null;
  creator_name: string;
  creator_initial: string;
  creator_avatar_bg: string;
  group_id: string | null;
  visibility: string;
  // event_id is the WC marker used to know whether RLS will gate this
  // RSVP behind has_wc_access() (migration 053). Null for non-event parties.
  event_id: string | null;
}

const REPORT_REASONS = [
  'Spam',
  'Inappropriate',
  'Misleading',
  'Safety Concern',
  'Other',
];

const AVATAR_COLORS = ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c'];

export default function WatchPartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [party, setParty] = useState<WatchPartyDetail | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [attendeeTotals, setAttendeeTotals] = useState<AttendeeTotals>({ going: 0, maybe: 0, cantGo: 0 });
  const [groupAffinity, setGroupAffinity] = useState<GroupAffinity[]>([]);
  const [isViewerHost, setIsViewerHost] = useState(false);
  const [invitees, setInvitees] = useState<{ name: string; phone: string; status: string }[]>([]);
  const [isCreator, setIsCreator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [showAllAttendees, setShowAllAttendees] = useState(false);
  // Surface WCPassPaywall when an RSVP is blocked by migration 053's
  // watch_party_rsvps_insert RLS gate (42501). The RPC is SECURITY DEFINER
  // and bypasses RLS, but defense-in-depth — we also catch the error code
  // in case the RPC is removed or its grants change.
  const [showWCPaywall, setShowWCPaywall] = useState(false);

  useEffect(() => {
    loadParty();
  }, [id]);

  // Realtime RSVP count updates
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeToRsvpCounts(id, () => {
      // Refetch attendees on any RSVP change
      loadAttendees();
    });
    return unsub;
  }, [id]);

  const loadParty = async () => {
    if (!id) return;
    setLoading(true);
    try {
      // Try the joined view first; fall back to base table if the view is
      // unavailable (missing grants, stale PostgREST schema cache, etc.).
      let data: any = null;
      const viewResult = await supabase
        .from('watch_party_details')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (viewResult.data) {
        data = viewResult.data;
      } else {
        if (viewResult.error) {
          console.warn('[watch-party] view query failed, falling back:', viewResult.error.message);
        }
        const baseResult = await supabase
          .from('watch_parties')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (baseResult.error) throw baseResult.error;
        if (!baseResult.data) throw new Error('Not found');
        data = baseResult.data;

        // Hydrate sport_name and creator_name with separate lookups.
        if (data.sport_id) {
          const { data: sportRow } = await supabase
            .from('sports')
            .select('name')
            .eq('id', data.sport_id)
            .maybeSingle();
          data.sport_name = sportRow?.name ?? '';
        }
        if (data.creator_id) {
          const { data: userRow } = await supabase
            .from('users')
            .select('display_name')
            .eq('auth_id', data.creator_id)
            .maybeSingle();
          data.creator_name = userRow?.display_name ?? 'Unknown';
        }
      }

      const sportName = data.sport_name || '';
      const creatorName = data.creator_name || 'Unknown';

      const startDate = new Date(data.starts_at);

      setParty({
        id: data.id,
        title: data.title || 'Watch Party',
        sport: sportName,
        sportEmoji: getSportEmoji(sportName),
        sportColor: getSportColor(sportName),
        venue_name: data.venue_name || 'Venue TBD',
        venue_address: data.venue_address || '',
        venue_area: data.venue_city || '',
        latitude: data.venue_lat || 0,
        longitude: data.venue_lon || 0,
        date: formatFullDate(data.starts_at),
        time: startDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }),
        atmosphere: data.atmosphere || 'chill',
        description: data.description || '',
        capacity: data.capacity || 50,
        rsvp_count: data.rsvp_count || 0,
        creator_id: data.creator_id ?? null,
        creator_name: creatorName,
        creator_initial: creatorName.charAt(0).toUpperCase(),
        creator_avatar_bg: '#3498db',
        group_id: null,
        visibility: 'public',
        event_id: data.event_id ?? null,
      });

      // Check if current user is the creator
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const creatorMatch = currentUser?.id === data.creator_id;
      setIsCreator(creatorMatch);

      // Load invitees if creator and private party
      if (creatorMatch && data.visibility === 'private') {
        const { data: inviteRows } = await supabase
          .from('watch_party_invites')
          .select('name, phone, status')
          .eq('watch_party_id', id);
        setInvitees(inviteRows ?? []);
      }

      await loadAttendees();
    } catch (e: any) {
      console.warn('[watch-party] loadParty failed:', e?.message ?? e);
      setParty(null);
    } finally {
      setLoading(false);
    }
  };

  const loadAttendees = async () => {
    if (!id) return;
    try {
      // v9.4.0 UAT Round 3 (#6, #9): moved to _v2 RPC (mig 084) which
      // is host-aware and returns totals per row. Guest branch gets
      // going only + summary; host branch gets all statuses ordered
      // going -> maybe -> cant_go with the same totals.
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const viewerId = currentUser?.id ?? null;

      const { data, error } = await supabase.rpc('get_watch_party_attendees_v2', {
        p_party_id: id,
        p_viewer_id: viewerId,
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        setAttendees([]);
        setAttendeeTotals({ going: 0, maybe: 0, cantGo: 0 });
      } else {
        const mappedAttendees: Attendee[] = data.map((r: any, i: number) => ({
          id: r.id,
          name: r.display_name,
          initial: r.display_name.charAt(0).toUpperCase(),
          avatarBg: AVATAR_COLORS[i % AVATAR_COLORS.length],
          status: r.status as 'going' | 'interested' | 'cant_go',
          userId: r.user_id,
        }));

        // v9.5: badges in the guest list. The attendees RPC returns only
        // what a viewer may see, so tiers come from the same batch accessor
        // the clips feed uses (mig 089). Silent-fail leaves the list
        // unbadged rather than missing.
        try {
          const ids = Array.from(
            new Set(mappedAttendees.map((a) => a.userId).filter(Boolean)),
          );
          if (ids.length > 0) {
            const { data: profiles } = await supabase.rpc('get_public_profiles', {
              p_user_ids: ids,
            });
            const tierById = new Map<string, string>(
              (profiles ?? [])
                .filter((r: any) => r.subscription_tier)
                .map((r: any) => [r.user_id as string, r.subscription_tier as string]),
            );
            for (const a of mappedAttendees) {
              if (a.userId && tierById.has(a.userId)) a.tier = tierById.get(a.userId);
            }
          }
        } catch {
          // the badge is decoration; the guest list is the feature
        }

        setAttendees(mappedAttendees);
        setAttendeeTotals({
          going: data[0].total_going ?? 0,
          maybe: data[0].total_maybe ?? 0,
          cantGo: data[0].total_cant_go ?? 0,
        });
        setIsViewerHost(!!data[0].is_host);
      }

      // Fan-group affinity callout (#6). Silent-fail so the section
      // still renders even if the RPC hits an unexpected error.
      if (viewerId) {
        const { data: affinityData } = await supabase.rpc(
          'get_watch_party_group_affinity',
          { p_party_id: id, p_viewer_id: viewerId },
        );
        setGroupAffinity((affinityData ?? []).map((r: any) => ({
          groupId: r.group_id,
          groupName: r.group_name,
          goingCount: r.going_count,
          distinctFans: r.distinct_fans ?? r.going_count,
        })));
      } else {
        setGroupAffinity([]);
      }
    } catch {
      // Keep existing attendees
    }
  };

  const displayedAttendees = showAllAttendees
    ? attendees
    : attendees.slice(0, 5);

  const handleRsvp = async (status: RsvpStatus) => {
    const newStatus = rsvpStatus === status ? null : status;

    // Rate limiter (FW-102): 20 RSVP toggles per day.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: allowed } = await supabase.rpc('check_rate_limit', {
          p_user_id: user.id,
          p_action: 'rsvp',
          p_max_count: 20,
          p_window_seconds: 86400,
        });
        if (allowed === false) return;
      }
    } catch {
      // If the rate-limit RPC itself fails, fall through — don't block a
      // user from RSVPing because of an infra hiccup.
    }

    // For Soccer Cup parties, bail early if the user lacks WC access so we
    // surface the WCPassPaywall rather than letting the RLS gate (migration
    // 053 watch_party_rsvps_insert) reject silently or leave the optimistic
    // UI in a "going" state that doesn't match server truth.
    const isWcParty = party?.event_id === WC_EVENT_ID;
    if (isWcParty && newStatus === 'going') {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: userRow } = await supabase
            .from('users')
            .select('wc_pass_active_until, subscription_status')
            .eq('auth_id', user.id)
            .maybeSingle();
          const wcUntil = userRow?.wc_pass_active_until
            ? new Date(userRow.wc_pass_active_until).getTime()
            : 0;
          const status = userRow?.subscription_status ?? 'none';
          const hasWcAccess =
            wcUntil > Date.now() || status === 'trial' || status === 'active';
          if (!hasWcAccess) {
            setShowWCPaywall(true);
            return;
          }
        }
      } catch {
        // If the check fails, proceed — the RPC + RLS will still gate.
      }
    }

    const previousStatus = rsvpStatus;
    setRsvpStatus(newStatus);

    try {
      const { error } = await supabase.rpc('rsvp_to_watch_party', {
        p_party_id: id ?? party?.id,
        p_status: newStatus ?? 'cancelled',
      });
      if (error) {
        if (
          error.code === '42501' ||
          /row-level security/i.test(error.message ?? '')
        ) {
          // Roll back optimistic update before surfacing paywall.
          setRsvpStatus(previousStatus);
          if (isWcParty) {
            setShowWCPaywall(true);
          } else {
            Alert.alert(
              "Can't RSVP yet",
              "This watch party requires an upgrade. Open Profile → Subscription to manage your plan.",
            );
          }
          return;
        }
        throw error;
      }
      // Refetch after server confirms so the totals + list reflect the
      // authoritative watch_party_rsvps state (was drifting on race
      // between optimistic UI and slow server acks — v9.4.2 UAT).
      loadAttendees();
    } catch (e) {
      // v9.4.2: was silently swallowing everything, which meant the RSVP
      // RPC being missing on prod (PGRST202) looked like a successful
      // "Going" tap while nothing was written server-side. Roll back the
      // optimistic pill AND surface a toast so the user knows to retry.
      setRsvpStatus(previousStatus);
      reportError(e, { source: 'watch-party:handleRsvp', partyId: id, status: newStatus });
      Alert.alert(
        "Couldn't save RSVP",
        "We couldn't reach the server. Check your connection and try again.",
      );
    }
  };

  const handleShare = async () => {
    if (!party) return;
    const { shareWatchParty } = await import('@/lib/sharing');
    await shareWatchParty({ id: party.id, title: party.title, venue: party.venue_name, city: party.venue_area, date: party.date });
  };

  const handleSubmitReport = async () => {
    if (!selectedReason) {
      Alert.alert('Select a reason', 'Please select a reason for your report.');
      return;
    }

    try {
      await supabase.rpc('flag_watch_party', {
        p_party_id: id ?? party?.id,
        p_reason: selectedReason,
        p_details: reportDetails.trim() || null,
      });
    } catch (e) {
      reportError(e, { source: 'watch-party:handleSubmitReport', partyId: id });
    }

    Alert.alert('Report submitted', 'Thank you. We will review this watch party.');
    setReportModalVisible(false);
    setSelectedReason(null);
    setReportDetails('');
  };

  const handleBlockHost = () => {
    if (!party?.creator_id) return;
    const creatorId = party.creator_id;
    const creatorName = party.creator_name;
    Alert.alert(
      'Block host',
      `Block ${creatorName}? You won't see their watch parties, clips, or messages, and they won't see yours. You can unblock from Profile → Blocked Users.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const ok = await blockUser(creatorId);
            if (ok) {
              Alert.alert('Blocked', `${creatorName} has been blocked.`);
              router.back();
            } else {
              Alert.alert('Could not block', 'Please try again.');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Watch Party</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!party) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Watch Party</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.dark.textSecondary, fontSize: 16 }}>
            Watch party not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const capacityPct = Math.min(party.rsvp_count / party.capacity, 1);
  const isPrivate = party.visibility === 'private';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Watch Party</Text>
        <TouchableOpacity onPress={handleShare} style={styles.headerBtn}>
          <Share2 size={22} color={Colors.dark.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Venue card
            v9.4.0 UAT Round 3 (#5): prior pill showed a "33.2056, -96.7335"
            lat/lng line in monospace beneath the address. Debug-y, no
            user value, actively cluttered a card that should read as
            professional. Dropped the coords line and boosted the venue
            typography. A real inline map preview needs react-native-maps
            + a static-tile URL; deferred to a follow-up. */}
        <View style={styles.mapPlaceholder}>
          <View style={styles.mapIconRow}>
            <MapPin size={22} color={Colors.dark.accent} />
            <Text style={styles.mapVenueName}>{party.venue_name}</Text>
          </View>
          <Text style={styles.mapAddress}>{party.venue_address}</Text>
        </View>

        {/* Party Info */}
        <View style={styles.infoSection}>
          <View style={[styles.sportBadge, { backgroundColor: party.sportColor + '22' }]}>
            <Text style={[styles.sportBadgeText, { color: party.sportColor }]}>
              {party.sportEmoji} {party.sport}
            </Text>
          </View>

          <Text style={styles.partyTitle}>{party.title}</Text>
          <Text style={styles.infoRow}>🍺 {party.venue_name} · {party.venue_area}</Text>
          <Text style={styles.infoRow}>📅 {party.date} · {party.time}</Text>

          <View style={styles.atmospherePill}>
            <Text style={styles.atmosphereText}>{party.atmosphere}</Text>
          </View>

          <View style={styles.capacityContainer}>
            <View style={styles.capacityBarBg}>
              <View
                style={[
                  styles.capacityBarFill,
                  {
                    width: `${capacityPct * 100}%`,
                    backgroundColor:
                      capacityPct >= 0.9
                        ? Colors.dark.error
                        : capacityPct >= 0.7
                        ? Colors.dark.warning
                        : Colors.dark.success,
                  },
                ]}
              />
            </View>
            <Text style={styles.capacityText}>
              {party.rsvp_count}/{party.capacity} going
            </Text>
          </View>
        </View>

        {/* RSVP Bar */}
        <View style={styles.rsvpBar}>
          <TouchableOpacity
            style={[
              styles.rsvpButton,
              rsvpStatus === 'going'
                ? { backgroundColor: Colors.dark.accent }
                : { borderColor: Colors.dark.accent, borderWidth: 1 },
            ]}
            onPress={() => handleRsvp('going')}
          >
            <Text
              style={[
                styles.rsvpButtonText,
                { color: rsvpStatus === 'going' ? '#ffffff' : Colors.dark.accent },
              ]}
            >
              Going
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.rsvpButton,
              rsvpStatus === 'interested'
                ? { backgroundColor: Colors.dark.warning }
                : { borderColor: Colors.dark.warning, borderWidth: 1 },
            ]}
            onPress={() => handleRsvp('interested')}
          >
            <Text
              style={[
                styles.rsvpButtonText,
                { color: rsvpStatus === 'interested' ? '#000000' : Colors.dark.warning },
              ]}
            >
              Maybe
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.rsvpButton,
              rsvpStatus === 'cant_go'
                ? { backgroundColor: Colors.dark.textMuted }
                : { borderColor: Colors.dark.textMuted, borderWidth: 1 },
            ]}
            onPress={() => handleRsvp('cant_go')}
          >
            <Text
              style={[
                styles.rsvpButtonText,
                { color: rsvpStatus === 'cant_go' ? '#ffffff' : Colors.dark.textMuted },
              ]}
            >
              Can't Go
            </Text>
          </TouchableOpacity>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.descriptionText}>
            {party.description || 'No description provided.'}
          </Text>
        </View>

        {/* Hosted By Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Hosted By</Text>
          <View style={styles.hostRow}>
            <View style={[styles.avatar, { backgroundColor: party.creator_avatar_bg }]}>
              <Text style={styles.avatarText}>{party.creator_initial}</Text>
            </View>
            <Text style={styles.hostName}>{party.creator_name}</Text>
            <View style={styles.hostBadge}>
              <Text style={styles.hostBadgeText}>Host</Text>
            </View>
          </View>
        </View>

        {/* Visibility Badge */}
        <View style={styles.section}>
          <View style={styles.visibilityBadge}>
            {isPrivate ? (
              <>
                <Lock size={16} color={Colors.dark.warning} />
                <Text style={[styles.visibilityText, { color: Colors.dark.warning }]}>
                  Private Watch Party — Invite Only
                </Text>
              </>
            ) : (
              <>
                <Globe size={16} color={Colors.dark.success} />
                <Text style={[styles.visibilityText, { color: Colors.dark.success }]}>
                  Public Watch Party — Open to All
                </Text>
              </>
            )}
          </View>
        </View>

        {/* Attendees Section
            v9.4.0 UAT Round 3 (#6, #9): shows a totals line at the top,
            a fan-group affinity callout when there are friends going
            from any of the viewer's groups, and either a host-view
            per-status breakdown or a guest-view "going only" list. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Attendees
          </Text>
          <Text style={styles.attendeeTotalsRow}>
            {attendeeTotals.going} going · {attendeeTotals.maybe} maybe · {attendeeTotals.cantGo} can't go
          </Text>

          {/* v9.4.3 UAT Round 4: ONE line, not one per group. The old
              per-group stack read as a headcount -- a single fan sharing
              five rooms with the viewer rendered five "1 fan ... also
              going" lines under a "1 going" header. distinctFans (mig 085)
              is the real number of people; the group names are context. */}
          {groupAffinity.length > 0 && groupAffinity[0].distinctFans > 0 && (
            <View style={styles.affinityCard}>
              <Text style={styles.affinityLine}>
                🎉 {groupAffinity[0].distinctFans}{' '}
                {groupAffinity[0].distinctFans === 1 ? 'fan' : 'fans'} from{' '}
                {groupAffinity.length === 1
                  ? groupAffinity[0].groupName
                  : `your groups (${groupAffinity.map((g) => g.groupName).join(', ')})`}
                {' '}also going
              </Text>
            </View>
          )}

          {attendees.length === 0 ? (
            <Text style={styles.descriptionText}>No attendees yet — be the first!</Text>
          ) : isViewerHost ? (
            // Host: grouped by status so they can see who's on the maybe /
            // can't-go lists. Guests never see this branch.
            (['going', 'interested', 'cant_go'] as const).map((bucket) => {
              const rows = attendees.filter((a) => a.status === bucket);
              if (rows.length === 0) return null;
              const label = bucket === 'going' ? 'Going' : bucket === 'interested' ? 'Maybe' : "Can't Go";
              return (
                <View key={bucket} style={{ marginTop: 8 }}>
                  <Text style={styles.attendeeSubheading}>{label} · {rows.length}</Text>
                  {rows.map((attendee) => (
                    <View key={attendee.id} style={styles.attendeeRow}>
                      <View style={[styles.avatar, { backgroundColor: attendee.avatarBg }]}>
                        <Text style={styles.avatarText}>{attendee.initial}</Text>
                      </View>
                      <Text style={styles.attendeeName}>{attendee.name}</Text>
                      <TierBadge tier={attendee.tier} compact />
                    </View>
                  ))}
                </View>
              );
            })
          ) : (
            // Guest: going-only list with same "View all" collapse.
            <>
              {displayedAttendees.map((attendee) => (
                <View key={attendee.id} style={styles.attendeeRow}>
                  <View style={[styles.avatar, { backgroundColor: attendee.avatarBg }]}>
                    <Text style={styles.avatarText}>{attendee.initial}</Text>
                  </View>
                  <Text style={styles.attendeeName}>{attendee.name}</Text>
                  <TierBadge tier={attendee.tier} compact />
                  <View style={[styles.statusBadge, { backgroundColor: Colors.dark.accent + '22' }]}>
                    <Text style={[styles.statusBadgeText, { color: Colors.dark.accent }]}>
                      Going
                    </Text>
                  </View>
                </View>
              ))}
              {!showAllAttendees && attendees.length > 5 && (
                <TouchableOpacity onPress={() => setShowAllAttendees(true)}>
                  <Text style={styles.viewAllLink}>
                    View all {attendees.length} attendees
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Invited Friends (creator only, private parties) */}
        {isCreator && invitees.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Invited ({invitees.length})</Text>
            {invitees.map((inv, i) => (
              <View key={i} style={styles.inviteeRow}>
                <View style={[styles.inviteeAvatar, { backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }]}>
                  <Text style={styles.inviteeInitial}>{inv.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inviteeName}>{inv.name}</Text>
                  {inv.phone ? <Text style={styles.inviteePhone}>{inv.phone}</Text> : null}
                </View>
                <View style={[
                  styles.inviteeStatus,
                  inv.status === 'accepted' && { backgroundColor: Colors.dark.success + '22' },
                  inv.status === 'declined' && { backgroundColor: Colors.dark.error + '22' },
                ]}>
                  <Text style={[
                    styles.inviteeStatusText,
                    inv.status === 'accepted' && { color: Colors.dark.success },
                    inv.status === 'declined' && { color: Colors.dark.error },
                  ]}>
                    {inv.status === 'accepted' ? 'Accepted' : inv.status === 'declined' ? 'Declined' : 'Pending'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          {party.group_id && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnOutline]}
              onPress={() => router.push(`/fan-group/${party.group_id}` as any)}
            >
              <MessageCircle size={18} color={Colors.dark.accent} />
              <Text style={[styles.actionBtnText, { color: Colors.dark.accent }]}>Chat</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnOutline]}
            onPress={handleShare}
          >
            <Share2 size={18} color={Colors.dark.accent} />
            <Text style={[styles.actionBtnText, { color: Colors.dark.accent }]}>Share</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnReport]}
            onPress={() => setReportModalVisible(true)}
          >
            <Flag size={18} color={Colors.dark.error} />
            <Text style={[styles.actionBtnText, { color: Colors.dark.error }]}>Report</Text>
          </TouchableOpacity>

          {!isCreator && party.creator_id && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnReport]}
              onPress={handleBlockHost}
            >
              <Slash size={18} color={Colors.dark.error} />
              <Text style={[styles.actionBtnText, { color: Colors.dark.error }]}>Block</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Report Modal */}
      <Modal
        visible={reportModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setReportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Report this watch party</Text>

            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[
                  styles.reasonCard,
                  selectedReason === reason && styles.reasonCardActive,
                ]}
                onPress={() => setSelectedReason(reason)}
              >
                <Text
                  style={[
                    styles.reasonText,
                    selectedReason === reason && styles.reasonTextActive,
                  ]}
                >
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}

            <TextInput
              style={styles.reportInput}
              placeholder="Additional details (optional)"
              placeholderTextColor={Colors.dark.textMuted}
              value={reportDetails}
              onChangeText={setReportDetails}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity style={styles.submitReportBtn} onPress={handleSubmitReport}>
              <Text style={styles.submitReportText}>Submit Report</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                setReportModalVisible(false);
                setSelectedReason(null);
                setReportDetails('');
              }}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <WCPassPaywall
        visible={showWCPaywall}
        onClose={() => setShowWCPaywall(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.border,
  },
  headerBtn: { padding: 6 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.dark.text },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 20 },
  mapPlaceholder: {
    backgroundColor: Colors.dark.surface,
    marginHorizontal: 16, marginTop: 16, borderRadius: 16, padding: 20,
    justifyContent: 'center', borderWidth: 1, borderColor: Colors.dark.border,
  },
  mapIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  mapVenueName: { fontSize: 18, fontWeight: '800', color: Colors.dark.text, letterSpacing: -0.2 },
  mapAddress: { fontSize: 13, color: Colors.dark.textSecondary, marginLeft: 30 },
  infoSection: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  sportBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  sportBadgeText: { fontSize: 13, fontWeight: '700' },
  partyTitle: { fontSize: 20, fontWeight: '700', color: Colors.dark.text },
  infoRow: { fontSize: 14, color: Colors.dark.textSecondary },
  atmospherePill: {
    alignSelf: 'flex-start', backgroundColor: Colors.dark.surface,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  atmosphereText: { fontSize: 13, color: Colors.dark.text },
  capacityContainer: { marginTop: 4 },
  capacityBarBg: { height: 8, backgroundColor: Colors.dark.surface, borderRadius: 4, overflow: 'hidden' },
  capacityBarFill: { height: '100%', borderRadius: 4 },
  capacityText: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 4 },
  rsvpBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 20 },
  rsvpButton: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rsvpButtonText: { fontSize: 14, fontWeight: '700' },
  section: { paddingHorizontal: 16, paddingTop: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text, marginBottom: 12 },
  descriptionText: { fontSize: 14, color: Colors.dark.textSecondary, lineHeight: 22 },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  hostName: { fontSize: 15, fontWeight: '600', color: Colors.dark.text, flex: 1 },
  hostBadge: { backgroundColor: Colors.dark.accent + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  hostBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.dark.accent },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  attendeeName: { fontSize: 14, color: Colors.dark.text, flex: 1 },
  attendeeTotalsRow: { fontSize: 13, color: Colors.dark.textSecondary, marginBottom: 10 },
  attendeeSubheading: { fontSize: 12, color: Colors.dark.textMuted, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  affinityCard: {
    backgroundColor: Colors.dark.accent + '18',
    borderColor: Colors.dark.accent + '55',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  affinityLine: { fontSize: 13, color: Colors.dark.text, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  viewAllLink: { fontSize: 13, color: Colors.dark.accent, fontWeight: '600', marginTop: 4 },
  visibilityBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.dark.surface, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.dark.border,
  },
  visibilityText: { fontSize: 13, fontWeight: '600' },
  actionButtons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 24 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12,
  },
  actionBtnOutline: { borderWidth: 1, borderColor: Colors.dark.accent },
  actionBtnReport: { borderWidth: 1, borderColor: Colors.dark.error },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Colors.dark.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.dark.text, marginBottom: 16 },
  reasonCard: {
    backgroundColor: Colors.dark.background, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  reasonCardActive: { borderColor: Colors.dark.accent, backgroundColor: Colors.dark.accent + '15' },
  reasonText: { fontSize: 14, color: Colors.dark.textSecondary },
  reasonTextActive: { color: Colors.dark.accent, fontWeight: '600' },
  reportInput: {
    backgroundColor: Colors.dark.background, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.dark.border, color: Colors.dark.text,
    fontSize: 14, padding: 14, marginTop: 8, marginBottom: 16,
    minHeight: 80, textAlignVertical: 'top',
  },
  submitReportBtn: {
    backgroundColor: Colors.dark.error, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginBottom: 10,
  },
  submitReportText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelBtnText: { fontSize: 14, color: Colors.dark.textSecondary },
  inviteeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  inviteeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteeInitial: { fontSize: 14, fontWeight: '700', color: '#fff' },
  inviteeName: { fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  inviteePhone: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 1 },
  inviteeStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.dark.surfaceLight,
  },
  inviteeStatusText: { fontSize: 11, fontWeight: '700', color: Colors.dark.textMuted },
});
