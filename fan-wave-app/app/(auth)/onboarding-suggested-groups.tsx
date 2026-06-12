import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, Users, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

type Reason = 'team' | 'city_sport' | 'wc_country';

interface SuggestedGroup {
  id: string;
  name: string;
  description: string | null;
  group_type: string;
  member_count: number | null;
  tags: string[] | null;
  city: string | null;
  reason: Reason;
}

const REASON_LABEL: Record<Reason, string> = {
  team: 'Your team',
  city_sport: 'Near you',
  wc_country: 'Soccer Cup',
};

export default function OnboardingSuggestedGroupsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [groups, setGroups] = useState<SuggestedGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const goNext = useCallback(() => {
    // Post-onboarding paywall flow set up earlier — keep it.
    router.replace('/(auth)/choose-plan');
  }, [router]);

  // Load suggestions on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) goNext();
          return;
        }

        const { data, error } = await supabase.rpc('suggest_fan_groups', {
          p_user_auth_id: user.id,
        });

        if (cancelled) return;

        if (error) {
          // Don't block onboarding — just skip the step.
          goNext();
          return;
        }

        const rows: SuggestedGroup[] = (data || []).map((r: any) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? null,
          group_type: r.group_type,
          member_count: r.member_count ?? null,
          tags: r.tags ?? null,
          city: r.city ?? null,
          reason: r.reason,
        }));

        // Dedupe by id (RPC may surface a room in multiple sections).
        const seen = new Set<string>();
        const deduped: SuggestedGroup[] = [];
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          deduped.push(r);
        }

        setGroups(deduped);
        // Pre-select everything — multi-select is the default we want.
        setSelected(new Set(deduped.map((g) => g.id)));
      } catch {
        if (!cancelled) goNext();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goNext]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleContinue = useCallback(async () => {
    if (submitting) return;
    if (selected.size === 0) {
      goNext();
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        goNext();
        return;
      }
      const rows = Array.from(selected).map((id) => ({
        chat_room_id: id,
        user_id: user.id,
      }));
      const { error } = await supabase.from('chat_room_members').insert(rows);
      if (error) {
        // Most common failure: a duplicate row (UNIQUE chat_room_id,user_id).
        // Don't block onboarding — just continue.
        if (!error.message?.toLowerCase().includes('duplicate')) {
          Alert.alert(
            "Couldn't join some groups",
            "We'll keep going — you can join them later from Discover.",
          );
        }
      }
    } finally {
      setSubmitting(false);
      goNext();
    }
  }, [selected, submitting, goNext]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
          <Text style={styles.loadingText}>Finding groups for you…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (groups.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Sparkles size={36} color={Colors.dark.accent} />
          <Text style={styles.title}>You're all set!</Text>
          <Text style={styles.subtitle}>
            We didn't find suggested groups yet — explore Discover to find your crew.
          </Text>
          <TouchableOpacity
            style={[styles.button, { marginTop: 32 }]}
            onPress={goNext}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Join your first groups</Text>
        <Text style={styles.subtitle}>
          We picked these based on your teams, city, and interests.
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {groups.map((g) => {
          const checked = selected.has(g.id);
          return (
            <TouchableOpacity
              key={g.id}
              style={[styles.card, checked && styles.cardSelected]}
              activeOpacity={0.85}
              onPress={() => toggle(g.id)}
            >
              <View style={styles.cardLeft}>
                <View style={styles.reasonPill}>
                  <Text style={styles.reasonText}>{REASON_LABEL[g.reason]}</Text>
                </View>
                <Text style={styles.groupName} numberOfLines={1}>
                  {g.name}
                </Text>
                {g.description ? (
                  <Text style={styles.groupDesc} numberOfLines={2}>
                    {g.description}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  <Users size={14} color={Colors.dark.textSecondary} />
                  <Text style={styles.metaText}>
                    {(g.member_count ?? 0).toLocaleString()} members
                  </Text>
                  {g.city ? (
                    <Text style={styles.metaText}> · {g.city}</Text>
                  ) : null}
                </View>
              </View>

              <View
                style={[
                  styles.checkbox,
                  checked && styles.checkboxChecked,
                ]}
              >
                {checked && <Check size={18} color={Colors.dark.text} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.bottom}>
        <TouchableOpacity onPress={goNext} disabled={submitting}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.button,
            submitting && styles.buttonDisabled,
          ]}
          onPress={handleContinue}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.dark.text} size="small" />
          ) : (
            <Text style={styles.buttonText}>
              {selected.size > 0
                ? `Join ${selected.size} group${selected.size === 1 ? '' : 's'}`
                : 'Continue'}
            </Text>
          )}
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
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.dark.text,
    marginBottom: 6,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    lineHeight: 20,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    gap: 12,
  },
  cardSelected: {
    borderColor: Colors.dark.accent,
    backgroundColor: 'rgba(108, 92, 231, 0.12)',
  },
  cardLeft: {
    flex: 1,
  },
  reasonPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.dark.background,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 6,
  },
  reasonText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.accent,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  groupName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  groupDesc: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  metaText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.dark.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  bottom: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    backgroundColor: Colors.dark.background,
  },
  skipText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: Colors.dark.accent,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
  },
});
