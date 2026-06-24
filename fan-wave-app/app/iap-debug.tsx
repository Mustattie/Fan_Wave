import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import {
  configureRevenueCat,
  getRevenueCatStatus,
  probeOfferings,
  useSubscriptionState,
  type RcStatus,
} from '@/lib/entitlements';
import { supabase } from '@/lib/supabase';

// IAP debug screen — designed to be opened from Profile in any build
// (dev / preview / production) so testers can verify the entire
// RevenueCat + Play Console + Supabase entitlements chain BEFORE
// shipping a build to users. Each row in the diagnostic checklist
// answers a single yes/no question; if any row is red, that's the
// failure point. Replaces the previous diagnose-by-guessing flow.

type ProbeResult = Awaited<ReturnType<typeof probeOfferings>>;

function Row({
  label,
  state,
  detail,
}: {
  label: string;
  state: 'ok' | 'fail' | 'pending' | 'idle';
  detail?: string;
}) {
  const Icon = state === 'ok' ? CheckCircle2 : state === 'fail' ? XCircle : AlertCircle;
  const color =
    state === 'ok'
      ? Colors.dark.success
      : state === 'fail'
        ? Colors.dark.error
        : state === 'pending'
          ? Colors.dark.warning
          : Colors.dark.textMuted;
  return (
    <View style={styles.row}>
      <Icon size={18} color={color} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail && <Text style={[styles.rowDetail, { color }]}>{detail}</Text>}
      </View>
    </View>
  );
}

function stateFor(value: boolean | null | undefined): 'ok' | 'fail' | 'idle' {
  if (value === true) return 'ok';
  if (value === false) return 'fail';
  return 'idle';
}

export default function IapDebugScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<RcStatus>(getRevenueCatStatus());
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [entitlementRow, setEntitlementRow] = useState<{
    subscription_status: string | null;
    premium_active_until: string | null;
    wc_pass_active_until: string | null;
  } | null>(null);
  const [entLoading, setEntLoading] = useState(true);
  const { data: entState } = useSubscriptionState();

  const refresh = useCallback(async () => {
    setStatus(getRevenueCatStatus());
    setEntLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('users')
          .select('subscription_status, premium_active_until, wc_pass_active_until')
          .eq('auth_id', user.id)
          .maybeSingle();
        setEntitlementRow(data ?? null);
      }
    } catch {
      setEntitlementRow(null);
    } finally {
      setEntLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleReconfigure = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    await configureRevenueCat(user?.id ?? null);
    setStatus(getRevenueCatStatus());
  }, []);

  const handleProbeOfferings = useCallback(async () => {
    setProbing(true);
    try {
      const result = await probeOfferings();
      setProbe(result);
    } finally {
      setProbing(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>IAP Diagnostics</Text>
        <TouchableOpacity onPress={refresh} style={styles.backBtn}>
          <RefreshCw size={20} color={Colors.dark.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeader}>RevenueCat SDK</Text>
        <View style={styles.card}>
          <Row
            label={`API key present (${status.apiKeyPlatform})`}
            state={status.apiKeyPresent ? 'ok' : 'fail'}
            detail={
              status.apiKeyPresent
                ? 'Loaded from EAS env / .env'
                : 'Missing — check eas.json env vars OR .env.production'
            }
          />
          <Row
            label="Native module loaded"
            state={stateFor(status.sdkRequireSucceeded)}
            detail={
              status.sdkRequireSucceeded === true
                ? 'react-native-purchases default export resolved'
                : status.sdkRequireSucceeded === false
                  ? 'require() threw — Expo Go OR native module not linked'
                  : 'Not attempted yet — tap Reconfigure'
            }
          />
          <Row
            label="Purchases.configure() succeeded"
            state={stateFor(status.configureSucceeded)}
            detail={
              status.configureSucceeded === true
                ? 'SDK ready for getOfferings / purchasePackage'
                : status.configureSucceeded === false
                  ? 'configure threw — see error below'
                  : status.configureCalled
                    ? 'In flight or failed silently'
                    : 'Not called yet'
            }
          />
          <Row
            label="Purchases.logIn(userId) succeeded"
            state={stateFor(status.loginSucceeded)}
            detail={
              status.loginSucceeded === true
                ? 'RC user tied to auth.users.id'
                : status.loginSucceeded === false
                  ? 'logIn threw — webhook attribution will be broken'
                  : status.loginCalled
                    ? 'In flight'
                    : 'No auth user yet'
            }
          />
          {status.lastError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Last error</Text>
              <Text style={styles.errorBody}>{status.lastError}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.btn} onPress={handleReconfigure}>
            <Text style={styles.btnText}>Re-run configure()</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>RevenueCat Dashboard + Play Console wiring</Text>
        <View style={styles.card}>
          <Text style={styles.cardSubtitle}>
            Probes the live RC offering. Confirms the dashboard has a "current" offering set AND the packages are mapped to Play Console product IDs that actually exist + are Active.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={handleProbeOfferings} disabled={probing}>
            {probing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnText}>Probe getOfferings()</Text>
            )}
          </TouchableOpacity>
          {probe && (
            <View style={{ marginTop: 12 }}>
              <Row
                label="getOfferings() returned"
                state={probe.ok ? 'ok' : 'fail'}
                detail={probe.error ?? 'SDK responded'}
              />
              {probe.ok && (
                <>
                  <Row
                    label="Current offering exists"
                    state={probe.currentOfferingId ? 'ok' : 'fail'}
                    detail={
                      probe.currentOfferingId
                        ? `id = ${probe.currentOfferingId}`
                        : 'No "current" offering set — fix in RC dashboard'
                    }
                  />
                  <Row
                    label="Packages on current offering"
                    state={probe.packageCount > 0 ? 'ok' : 'fail'}
                    detail={
                      probe.packageCount > 0
                        ? `${probe.packageCount} package(s): ${probe.packageIds.join(', ')}`
                        : 'No packages — RC dashboard "Packages" tab is empty'
                    }
                  />
                  <Row
                    label="Product IDs visible"
                    state={probe.productIds.length > 0 ? 'ok' : 'fail'}
                    detail={
                      probe.productIds.length > 0
                        ? probe.productIds.join(', ')
                        : 'Empty — Play Console products not synced (or wrong package name)'
                    }
                  />
                </>
              )}
            </View>
          )}
        </View>

        <Text style={styles.sectionHeader}>Supabase entitlement state</Text>
        <View style={styles.card}>
          <Text style={styles.cardSubtitle}>
            Source of truth for "Is this user Premium?". Should flip to 'trial' / 'active' within ~1s of a successful purchase via the RC webhook.
          </Text>
          {entLoading ? (
            <ActivityIndicator size="small" color={Colors.dark.accent} />
          ) : (
            <>
              <Row
                label="users row found"
                state={entitlementRow ? 'ok' : 'fail'}
                detail={entitlementRow ? '' : 'No row — migration 022 trigger may have skipped'}
              />
              <Row
                label="subscription_status"
                state="idle"
                detail={entitlementRow?.subscription_status ?? 'null'}
              />
              <Row
                label="premium_active_until"
                state="idle"
                detail={entitlementRow?.premium_active_until ?? 'null'}
              />
              <Row
                label="wc_pass_active_until"
                state="idle"
                detail={entitlementRow?.wc_pass_active_until ?? 'null'}
              />
              <Row
                label="Client says hasPremiumAccess"
                state={entState?.hasPremiumAccess ? 'ok' : 'idle'}
                detail={entState?.hasPremiumAccess ? 'true' : 'false'}
              />
              <Row
                label="Client says hasWCAccess"
                state={entState?.hasWCAccess ? 'ok' : 'idle'}
                detail={entState?.hasWCAccess ? 'true' : 'false'}
              />
            </>
          )}
        </View>

        <Text style={styles.sectionHeader}>How to read this</Text>
        <View style={styles.card}>
          <Text style={styles.bodyText}>
            • <Text style={styles.bold}>Any red row in section 1</Text> = the SDK never came online. Production build will surface "no singleton instance" / "purchase could not start". Fix the red row first.
          </Text>
          <Text style={styles.bodyText}>
            • <Text style={styles.bold}>Red rows in section 2</Text> = RC dashboard or Play Console is wrong. SDK is fine, but there's nothing to purchase. Most common: forgot to set the "current" offering, or Play products are in draft.
          </Text>
          <Text style={styles.bodyText}>
            • <Text style={styles.bold}>Section 3 stays at null after a test purchase</Text> = RC → Supabase webhook isn't firing. Check the webhook URL in RC dashboard and the entitlements function in Supabase.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.surface,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: Colors.dark.text },
  scroll: { padding: 16, paddingBottom: 32 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  cardSubtitle: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 17,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  rowDetail: { fontSize: 12, marginTop: 2 },
  errorBox: {
    backgroundColor: Colors.dark.error + '18',
    borderWidth: 1,
    borderColor: Colors.dark.error + '60',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  errorTitle: { fontSize: 11, fontWeight: '700', color: Colors.dark.error, marginBottom: 4 },
  errorBody: { fontSize: 12, color: Colors.dark.error, lineHeight: 17 },
  btn: {
    marginTop: 10,
    backgroundColor: Colors.dark.accent,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  bodyText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 19,
    marginBottom: 8,
  },
  bold: { color: Colors.dark.text, fontWeight: '700' },
});
