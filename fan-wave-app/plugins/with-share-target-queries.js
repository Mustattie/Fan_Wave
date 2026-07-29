/**
 * Expo config plugin: inject <queries> entries into AndroidManifest so
 * Linking.canOpenURL('instagram://') / .canOpenURL('tiktok://') actually
 * return `true` when those apps are installed.
 *
 * v9.2.6 UAT 2026-07-28: users reported "Instagram not installed" on
 * devices where IG is installed. Root cause: Android 11 (API 30) added
 * package visibility restrictions — apps must declare which packages
 * or intents they want to query. Without a matching <queries> entry,
 * canOpenURL returns false and the share flow shows the wrong error.
 *
 * Mirrors the modern Expo pattern (withAndroidManifest mod). No JS-only
 * fallback works for canOpenURL on Android 11+.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const PACKAGES = [
  'com.instagram.android',
  'com.zhiliaoapp.musically', // TikTok (Global)
  'com.ss.android.ugc.trill', // TikTok (some regions)
];

const INTENTS = [
  { action: 'android.intent.action.VIEW', scheme: 'https' },
  { action: 'android.intent.action.SEND', mimeType: 'video/*' },
  { action: 'android.intent.action.SEND', mimeType: 'image/*' },
  { action: 'android.intent.action.SEND', mimeType: 'text/plain' },
];

module.exports = function withShareTargetQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = Array.isArray(manifest.queries) ? manifest.queries : [];

    const existing = manifest.queries[0] ?? {};
    const existingPackages = new Set(
      (existing.package ?? []).map((p) => p.$?.['android:name']).filter(Boolean),
    );

    const packageEntries = PACKAGES.filter((p) => !existingPackages.has(p)).map(
      (p) => ({ $: { 'android:name': p } }),
    );

    const intentEntries = INTENTS.map((intent) => {
      const entry = {
        action: [{ $: { 'android:name': intent.action } }],
      };
      if (intent.scheme) {
        entry.data = [{ $: { 'android:scheme': intent.scheme } }];
      }
      if (intent.mimeType) {
        entry.data = [{ $: { 'android:mimeType': intent.mimeType } }];
      }
      return entry;
    });

    manifest.queries[0] = {
      ...existing,
      package: [...(existing.package ?? []), ...packageEntries],
      intent: [...(existing.intent ?? []), ...intentEntries],
    };

    return cfg;
  });
};
