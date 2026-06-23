import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Share2 } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { shareWatchParty } from '@/lib/sharing';
import { useMyRsvps } from '@/hooks/useData';
import { queryClient } from '@/hooks/useQueryClient';
import type { WatchPartyDisplay } from '@/lib/mappers';

interface WatchPartyCardProps {
  party: WatchPartyDisplay;
}

export function WatchPartyCard({ party }: WatchPartyCardProps) {
  const router = useRouter();
  const { data: myRsvps = {} } = useMyRsvps();
  // v8.7+ P0: hydrate from the shared cache so the same party renders the
  // same "Going / Interested / RSVP" label on Home, Discover, and any other
  // surface. Previously each card mounted with rsvpStatus='none' regardless
  // of DB state — the v8.6 UAT "RSVP doesn't persist across tabs" symptom.
  const cachedStatus = myRsvps[party.id];
  const initialStatus: 'none' | 'going' | 'interested' =
    cachedStatus === 'going' || cachedStatus === 'interested' ? cachedStatus : 'none';
  const [rsvpStatus, setRsvpStatus] = useState<'none' | 'going' | 'interested'>(initialStatus);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  // Keep local state in sync when the shared cache refreshes (focus refetch,
  // realtime invalidation, etc.). Without this the card snapshots the cache
  // value on mount only and drifts.
  useEffect(() => {
    const next: 'none' | 'going' | 'interested' =
      cachedStatus === 'going' || cachedStatus === 'interested' ? cachedStatus : 'none';
    setRsvpStatus(next);
  }, [cachedStatus]);

  const handleCardPress = () => {
    router.push(`/watch-party/${party.id}` as any);
  };

  const handleRsvp = async () => {
    const nextStatus: 'going' | 'interested' | 'declined' =
      rsvpStatus === 'none' ? 'going' : rsvpStatus === 'going' ? 'interested' : 'declined';

    setRsvpLoading(true);
    try {
      const { error } = await supabase.rpc('rsvp_to_watch_party', {
        p_party_id: party.id,
        p_status: nextStatus,
      });

      if (error) {
        // Surface the real error rather than swallowing it — silent failure
        // is exactly why the v8.3 UAT report said "RSVP not saved": the RPC
        // was throwing (with a now-visible reason) and the local state was
        // updating optimistically anyway.
        const code: any = (error as any)?.code;
        const msg: string = error.message ?? 'Unknown error';
        const friendly =
          code === '42501' && msg.toLowerCase().includes('wc_pass_required')
            ? 'Soccer Cup Pass required to RSVP to this party.'
            : code === '53400'
              ? 'This watch party is at capacity.'
              : `RSVP could not be saved: ${msg}`;
        Alert.alert('RSVP failed', friendly);
        setRsvpLoading(false);
        return;
      }
      // Only update local state on success — prior code optimistically set
      // "Going" even when the RPC threw, masking the bug from the user.
      setRsvpStatus(nextStatus === 'declined' ? 'none' : nextStatus);
      // Invalidate the shared RSVP cache so every other WatchPartyCard on
      // every other screen reflects the same Going/Interested/none label.
      queryClient.invalidateQueries({ queryKey: ['myRsvps'] });
    } catch (e: any) {
      Alert.alert('RSVP failed', e?.message ?? 'Network error — please try again.');
    } finally {
      setRsvpLoading(false);
    }
  };

  const rsvpLabel = rsvpStatus === 'going' ? '✓ Going' : rsvpStatus === 'interested' ? '★ Interested' : 'RSVP';
  const rsvpBg = rsvpStatus === 'going' ? Colors.dark.success : rsvpStatus === 'interested' ? Colors.dark.warning : Colors.dark.accent;
  const displayCount = rsvpStatus === 'going' ? party.rsvpCount + 1 : party.rsvpCount;

  return (
    <TouchableOpacity style={styles.card} onPress={handleCardPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <View
          style={[
            styles.sportBadge,
            { backgroundColor: `${party.sportColor}22` },
          ]}
        >
          <Text style={[styles.sportBadgeText, { color: party.sportColor }]}>
            {party.sportIcon} {party.sport.toUpperCase()}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.rsvpButton, { backgroundColor: rsvpBg }]}
          onPress={handleRsvp}
          disabled={rsvpLoading}
        >
          {rsvpLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.rsvpButtonText}>{rsvpLabel}</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>{party.title}</Text>
      <Text style={styles.venue}>
        🍺 {party.venue} · {party.venueArea}
      </Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>📅 {party.date}</Text>
        <Text style={styles.meta}>
          👥 {displayCount}/{party.capacity} going
        </Text>
      </View>

      {party.attendees.length > 0 && (
        <View style={styles.attendeeRow}>
          {party.attendees.map((a, i) => (
            <View
              key={i}
              style={[
                styles.attendeeAvatar,
                { backgroundColor: a.color, marginLeft: i > 0 ? -8 : 0 },
              ]}
            >
              <Text style={styles.attendeeText}>{a.initials}</Text>
            </View>
          ))}
          {party.rsvpCount > party.attendees.length && (
            <View
              style={[
                styles.attendeeAvatar,
                { backgroundColor: Colors.dark.textMuted, marginLeft: -8 },
              ]}
            >
              <Text style={styles.attendeeText}>
                +{party.rsvpCount - party.attendees.length}
              </Text>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity
        style={styles.shareBtn}
        onPress={() => shareWatchParty({ id: party.id, title: party.title, venue: party.venue, city: party.venueArea, date: party.date })}
        activeOpacity={0.7}
      >
        <Share2 size={14} color={Colors.dark.textSecondary} />
        <Text style={styles.shareBtnText}>Share</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sportBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sportBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rsvpButton: {
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  rsvpButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 4,
  },
  venue: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
  },
  meta: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  attendeeRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  attendeeAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendeeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: Colors.dark.surfaceLight,
  },
  shareBtnText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
});
