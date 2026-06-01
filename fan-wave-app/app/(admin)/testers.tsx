import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Users, CheckCircle2, XCircle, Download, Bot,
} from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { FilterPillRow } from '@/components/FilterPillRow';
import {
  useTesterSummary, useTesterCohortSummary,
  type TesterSummaryRow,
} from '@/hooks/useBetaTesterData';

const COHORT_OPTIONS = ['All', 'Internal QA', 'External Beta'];
const COHORT_MAP: Record<string, string | null> = {
  All: null,
  'Internal QA': 'wc2026-internal',
  'External Beta': 'wc2026-external',
};

const DAYS = 14;

// Sheet-friendly column set + values per row. Used by the CSV export.
const SHEET_COLUMNS: Array<[keyof TesterSummaryRow, string]> = [
  ['display_name',             'Display Name'],
  ['cohort',                   'Cohort'],
  ['recruited_via',            'Recruited Via'],
  ['added_at',                 'Added At'],
  ['first_event_at',           'First Event'],
  ['last_event_at',            'Last Event'],
  ['active_days',              'Active Days'],
  ['total_events',             'Total Events'],
  ['screens_visited',          'Screens Visited'],
  ['distinct_event_types',     'Distinct Event Types'],
  ['sessions_estimated',       'Sessions (est.)'],
  ['signed_up',                'Signed Up'],
  ['onboarded',                'Onboarded'],
  ['created_group',            'Created Group'],
  ['joined_group',             'Joined Group'],
  ['created_party',            'Created Party'],
  ['rsvped_party',             'RSVPd Party'],
  ['sent_message',             'Sent Message'],
  ['uploaded_clip',            'Uploaded Clip'],
  ['liked_clip',               'Liked Clip'],
  ['shared_clip',              'Shared Clip'],
  ['exported_clip',            'Exported Clip'],
  ['shared_invite',            'Shared Invite'],
  ['opened_paywall',           'Opened Paywall'],
  ['visited_world_cup_tab',    'Visited WC Tab'],
  ['sandbox_purchase_attempts','Sandbox IAP Attempts'],
  ['latest_entitlement_status','Entitlement Status'],
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: TesterSummaryRow[]): string {
  const header = SHEET_COLUMNS.map(([, label]) => label).join(',');
  const body = rows.map((r) =>
    SHEET_COLUMNS.map(([key]) => csvEscape(r[key])).join(','),
  ).join('\n');
  return header + '\n' + body + '\n';
}

async function exportCsv(rows: TesterSummaryRow[], filename: string) {
  try {
    const csv = rowsToCsv(rows);
    const Sharing = await import('expo-sharing');
    const FS = await import('expo-file-system/legacy');
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Sharing unavailable', 'expo-sharing is not available on this device.');
      return;
    }
    const path = `${FS.cacheDirectory}${filename}`;
    await FS.writeAsStringAsync(path, csv, { encoding: FS.EncodingType.UTF8 });
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Export tester activity',
      UTI: 'public.comma-separated-values-text',
    });
  } catch (e) {
    Alert.alert('Export failed', e instanceof Error ? e.message : 'Unknown error');
  }
}

function Flag({ on }: { on: boolean }) {
  return on
    ? <CheckCircle2 size={14} color={Colors.dark.success} />
    : <XCircle size={14} color={Colors.dark.textMuted} />;
}

export default function AdminTesters() {
  const [cohortFilter, setCohortFilter] = useState('All');
  const cohort = COHORT_MAP[cohortFilter];

  const { data: cohorts, isLoading: cohortsLoading } = useTesterCohortSummary(DAYS);
  const { data: testers, isLoading: testersLoading } = useTesterSummary(DAYS, cohort);

  // Two-sheet split: humans (everything except automated_qa) vs automated.
  const humanRows = useMemo(
    () => (testers ?? []).filter((t) => t.recruited_via !== 'automated_qa'),
    [testers],
  );
  const qaRows = useMemo(
    () => (testers ?? []).filter((t) => t.recruited_via === 'automated_qa'),
    [testers],
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <FilterPillRow items={COHORT_OPTIONS} activeItem={cohortFilter} onSelect={setCohortFilter} />

        {/* ─── Cohort summary cards ─── */}
        {cohortsLoading ? (
          <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />
        ) : (
          <View style={styles.cohortRow}>
            {(cohorts ?? []).map((c) => (
              <View key={c.cohort} style={styles.cohortCard}>
                <Text style={styles.cohortLabel}>{c.cohort}</Text>
                <Text style={styles.cohortStat}>{c.active_testers} / {c.tester_count}</Text>
                <Text style={styles.cohortHint}>
                  active testers — avg {Number(c.avg_active_days).toFixed(1)} days
                </Text>
                <Text style={styles.cohortHint}>
                  {c.total_events} events · {c.total_purchase_probes} IAP probes
                </Text>
              </View>
            ))}
            {(!cohorts || cohorts.length === 0) && (
              <Text style={styles.empty}>No cohorts yet. Add testers via admin_add_beta_tester().</Text>
            )}
          </View>
        )}

        {/* ─── Export buttons ─── */}
        <View style={styles.exportRow}>
          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => exportCsv(humanRows, `fan-sphere-beta-testers-${DAYS}d.csv`)}
            disabled={humanRows.length === 0}
          >
            <Download size={16} color={Colors.dark.accent} />
            <Text style={styles.exportText}>Export humans ({humanRows.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => exportCsv(qaRows, `fan-sphere-automated-qa-${DAYS}d.csv`)}
            disabled={qaRows.length === 0}
          >
            <Bot size={16} color={Colors.dark.textSecondary} />
            <Text style={styles.exportText}>Export automated QA ({qaRows.length})</Text>
          </TouchableOpacity>
        </View>

        {/* ─── Tester rows ─── */}
        {testersLoading ? (
          <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />
        ) : (testers ?? []).length === 0 ? (
          <Text style={styles.empty}>No testers in this cohort yet.</Text>
        ) : (
          <View style={styles.list}>
            {(testers ?? []).map((t) => (
              <View key={t.user_id} style={styles.row}>
                <View style={styles.rowHeader}>
                  <View style={styles.rowHeaderLeft}>
                    {t.recruited_via === 'automated_qa'
                      ? <Bot size={16} color={Colors.dark.textSecondary} />
                      : <Users size={16} color={Colors.dark.accent} />}
                    <Text style={styles.rowName}>{t.display_name}</Text>
                  </View>
                  <View style={styles.rowHeaderRight}>
                    <Text style={styles.rowCohort}>{t.cohort}</Text>
                  </View>
                </View>

                <View style={styles.statRow}>
                  <Stat label="Active days" value={`${t.active_days} / ${DAYS}`} />
                  <Stat label="Events" value={t.total_events} />
                  <Stat label="Distinct" value={t.distinct_event_types} />
                  <Stat label="Sessions" value={t.sessions_estimated} />
                  <Stat label="IAP" value={t.sandbox_purchase_attempts} />
                </View>

                <View style={styles.flagGrid}>
                  <FlagItem label="Signed up"     on={t.signed_up} />
                  <FlagItem label="Onboarded"     on={t.onboarded} />
                  <FlagItem label="Created group" on={t.created_group} />
                  <FlagItem label="Joined group"  on={t.joined_group} />
                  <FlagItem label="Created party" on={t.created_party} />
                  <FlagItem label="RSVPd party"   on={t.rsvped_party} />
                  <FlagItem label="Sent message"  on={t.sent_message} />
                  <FlagItem label="Uploaded clip" on={t.uploaded_clip} />
                  <FlagItem label="Liked clip"    on={t.liked_clip} />
                  <FlagItem label="Shared clip"   on={t.shared_clip} />
                  <FlagItem label="Exported clip" on={t.exported_clip} />
                  <FlagItem label="Shared invite" on={t.shared_invite} />
                  <FlagItem label="Opened paywall" on={t.opened_paywall} />
                  <FlagItem label="WC tab"        on={t.visited_world_cup_tab} />
                </View>

                <Text style={styles.recruited}>
                  Recruited via: {t.recruited_via ?? '(unspecified)'}
                  {t.latest_entitlement_status ? ` · ${t.latest_entitlement_status}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function FlagItem({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={styles.flagItem}>
      <Flag on={on} />
      <Text style={[styles.flagLabel, !on && styles.flagLabelOff]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  scroll: { paddingBottom: 40 },
  loader: { marginTop: 40 },
  cohortRow: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12,
    flexWrap: 'wrap',
  },
  cohortCard: {
    flex: 1, minWidth: 160,
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    padding: 12, gap: 4,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  cohortLabel: { fontSize: 11, color: Colors.dark.textMuted, textTransform: 'uppercase' },
  cohortStat: { fontSize: 22, fontWeight: '700', color: Colors.dark.text },
  cohortHint: { fontSize: 11, color: Colors.dark.textSecondary },
  exportRow: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12,
  },
  exportBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 8,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  exportText: { fontSize: 12, fontWeight: '600', color: Colors.dark.text },
  list: { paddingHorizontal: 16, gap: 12 },
  row: {
    backgroundColor: Colors.dark.surface, borderRadius: 12, padding: 14, gap: 10,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rowHeaderRight: {},
  rowName: { fontSize: 14, fontWeight: '700', color: Colors.dark.text },
  rowCohort: { fontSize: 10, color: Colors.dark.textMuted, textTransform: 'uppercase' },
  statRow: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.dark.text },
  statLabel: { fontSize: 10, color: Colors.dark.textMuted, marginTop: 2 },
  flagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  flagItem: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  flagLabel: { fontSize: 10, color: Colors.dark.text },
  flagLabelOff: { color: Colors.dark.textMuted },
  recruited: { fontSize: 10, color: Colors.dark.textMuted, marginTop: 4 },
  empty: { color: Colors.dark.textMuted, fontSize: 14, textAlign: 'center', marginTop: 24, paddingHorizontal: 16 },
});
