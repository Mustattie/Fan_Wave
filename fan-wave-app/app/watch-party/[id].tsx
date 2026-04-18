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
} from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { subscribeToRsvpCounts } from '@/lib/realtime';
import { getSportEmoji, getSportColor, formatFullDate } from '@/lib/mappers';

type RsvpStatus = 'going' | 'interested' | 'cant_go' | null;

interface Attendee {
  id: string;
  name: string;
  initial: string;
  avatarBg: string;
  status: 'going' | 'interested';
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
  creator_name: string;
  creator_initial: string;
  creator_avatar_bg: string;
  group_id: string | null;
  visibility: string;
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
  const [invitees, setInvitees] = useState<{ name: string; phone: string; status: string }[]>([]);
  const [isCreator, setIsCreator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [showAllAttendees, setShowAllAttendees] = useState(false);

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
      const { data, error } = await supabase
        .from('watch_party_details')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Not found');

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
        creator_name: creatorName,
        creator_initial: creatorName.charAt(0).toUpperCase(),
        creator_avatar_bg: '#3498db',
        group_id: null,
        visibility: 'public',
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
    } catch {
      setParty(null);
    } finally {
      setLoading(false);
    }
  };

  const loadAttendees = async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .rpc('get_watch_party_attendees', { p_party_id: id });

      if (error) throw error;
      if (!data || data.length === 0) {
        setAttendees([]);
        return;
      }

      setAttendees(data.map((r: any, i: number) => ({
        id: r.id,
        name: r.display_name,
        initial: r.display_name.charAt(0).toUpperCase(),
        avatarBg: AVATAR_COLORS[i % AVATAR_COLORS.length],
        status: r.status as 'going' | 'interested',
      })));
    } catch {
      // Keep existing attendees
    }
  };

  const displayedAttendees = showAllAttendees
    ? attendees
    : attendees.slice(0, 5);

  const handleRsvp = async (status: RsvpStatus) => {
    const newStatus = rsvpStatus === status ? null : status;
    setRsvpStatus(newStatus);

    try {
      await supabase.rpc('rsvp_to_watch_party', {
        p_party_id: id ?? party?.id,
        p_status: newStatus ?? 'cancelled',
      });
    } catch {}
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
    } catch {}

    Alert.alert('Report submitted', 'Thank you. We will review this watch party.');
    setReportModalVisible(false);
    setSelectedReason(null);
    setReportDetails('');
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
        {/* Map Placeholder */}
        <View style={styles.mapPlaceholder}>
          <View style={styles.mapIconRow}>
            <MapPin size={20} color={Colors.dark.accent} />
            <Text style={styles.mapVenueName}>📍 {party.venue_name}</Text>
          </View>
          <Text style={styles.mapAddress}>{party.venue_address}</Text>
          <Text style={styles.mapCoords}>
            {party.latitude.toFixed(4)}, {party.longitude.toFixed(4)}
          </Text>
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
              Interested
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

        {/* Attendees Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Attendees ({attendees.length})
          </Text>
          {attendees.length === 0 ? (
            <Text style={styles.descriptionText}>No attendees yet — be the first!</Text>
          ) : (
            <>
              {displayedAttendees.map((attendee) => (
                <View key={attendee.id} style={styles.attendeeRow}>
                  <View style={[styles.avatar, { backgroundColor: attendee.avatarBg }]}>
                    <Text style={styles.avatarText}>{attendee.initial}</Text>
                  </View>
                  <Text style={styles.attendeeName}>{attendee.name}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          attendee.status === 'going'
                            ? Colors.dark.accent + '22'
                            : Colors.dark.warning + '22',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        {
                          color:
                            attendee.status === 'going'
                              ? Colors.dark.accent
                              : Colors.dark.warning,
                        },
                      ]}
                    >
                      {attendee.status === 'going' ? 'Going' : 'Interested'}
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
    height: 180, backgroundColor: Colors.dark.surface,
    marginHorizontal: 16, marginTop: 16, borderRadius: 16, padding: 20,
    justifyContent: 'center', borderWidth: 1, borderColor: Colors.dark.border,
  },
  mapIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  mapVenueName: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  mapAddress: { fontSize: 13, color: Colors.dark.textSecondary, marginBottom: 6 },
  mapCoords: {
    fontSize: 11, color: Colors.dark.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
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
