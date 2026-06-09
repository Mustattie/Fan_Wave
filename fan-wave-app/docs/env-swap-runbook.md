# Production Env-Swap Runbook

This runbook explains exactly how to flip the app from the dev Supabase project
(currently shipped in the live Play Store build via the `preview` profile) to a
brand-new production Supabase project once credentials are in hand.

The work is intentionally concentrated in two source-controlled files so the
diff is reviewable and a single commit ships the change.

---

## 0. Inputs you must have before starting

Collect these values from the new production Supabase project + supporting
services. Do not start until all five are available — partial swaps cause silent
half-broken builds.

| Variable | Where to get it |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → `anon` public key |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | RevenueCat dashboard → Project (prod) → API Keys → iOS public SDK key |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | RevenueCat dashboard → Project (prod) → API Keys → Android public SDK key |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry → Settings → Projects → Client Keys (DSN). Use the prod project's DSN, not the dev one. |

Prerequisite: all 44 migrations (`supabase/migrations/`) must already be applied
to the new prod Postgres database, and the RevenueCat webhook must already be
pointing at the new prod edge function URL. Those are separate workstreams —
this runbook only covers the client-side env-swap.

---

## 1. Edit `eas.json`

Open `eas.json` and locate the `build.production.env` block. Replace each
placeholder token with the real value collected in step 0.

```jsonc
"production": {
  "_comment": "Production profile: ...",
  "autoIncrement": true,
  "ios": { "image": "latest" },
  "android": { "image": "latest" },
  "env": {
    "APP_ENV": "production",
    "EXPO_PUBLIC_SUPABASE_URL":         "__SET_PROD_SUPABASE_URL__",          // → https://<ref>.supabase.co
    "EXPO_PUBLIC_SUPABASE_ANON_KEY":    "__SET_PROD_SUPABASE_ANON_KEY__",     // → eyJhbGciOi...
    "EXPO_PUBLIC_REVENUECAT_IOS_KEY":   "__SET_PROD_REVENUECAT_IOS_KEY__",    // → appl_...
    "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY":"__SET_PROD_REVENUECAT_ANDROID_KEY__",// → goog_...
    "EXPO_PUBLIC_SENTRY_DSN":           "__SET_PROD_SENTRY_DSN__"             // → https://<key>@<host>/<id>
  }
}
```

Leave `submit.production.android.track` set to `"production"` — that's already
the intended live track. Do not touch the `preview` profile (it intentionally
still points at the dev Supabase project for QA/staging builds).

## 2. Edit `.env.production`

Mirror the same values into `.env.production`. This file is loaded when running
the app locally with `APP_ENV=production` (rare, but used for prod-config smoke
tests on a dev machine).

```
EXPO_PUBLIC_SUPABASE_URL=<same as eas.json>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<same as eas.json>
EXPO_PUBLIC_REVENUECAT_IOS_KEY=<same as eas.json>
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=<same as eas.json>
EXPO_PUBLIC_SENTRY_DSN=<same as eas.json>
```

## 3. Verify the swap

Run this from `fan-wave-app/` to prove zero placeholders survived:

```powershell
# Should return NO matches. If anything prints, the swap is incomplete.
Select-String -Path eas.json,.env.production -Pattern '__SET_|YOUR_PRODUCTION|YOUR_STAGING'
```

Bash equivalent:

```bash
grep -nE '__SET_|YOUR_PRODUCTION|YOUR_STAGING' eas.json .env.production && echo "FAIL: placeholders remain" || echo "OK"
```

Additionally, the runtime guard in `lib/supabase.ts` will throw on app boot if
any placeholder token leaks into a build — so a misconfigured APK/AAB will
crash immediately at startup with a clear error rather than silently appearing
to connect.

## 4. Commit

```powershell
git add eas.json .env.production
git commit -m "Swap to production Supabase + RevenueCat + Sentry credentials"
```

Keep this commit small and isolated — it is your rollback handle (step 6).

## 5. Build + submit (the validation gauntlet first)

Run the standard local validation gauntlet before burning EAS credits:

```powershell
npx tsc --noEmit
npx expo-doctor
# Optional but recommended:
npx expo prebuild --no-install --clean --platform android
```

Then build + submit. Two equivalent flows:

**Combined (one command):**

```powershell
eas build --profile production --platform android --auto-submit-with-profile production
```

**Split (recommended if you want to inspect the AAB before shipping):**

```powershell
eas build --profile production --platform android
# Wait for the build to finish, then:
eas submit --profile production --platform android --latest
```

iOS follows the same pattern with `--platform ios` (uses the ASC API key already
wired into `submit.production.ios`).

## 6. Rollback

If a production build goes out and something is broken:

1. **Halt the rollout in Play Console** — Release → Production → Halt rollout.
   (Also: App Store Connect → remove from sale, if iOS.)
2. **Revert the env-swap commit:**
   ```powershell
   git revert <commit-sha-from-step-4>
   git push
   ```
   This restores the placeholder tokens, which means the next `eas build
   --profile production` will fail fast at runtime (via the `lib/supabase.ts`
   guard) — protecting you from re-shipping the bad config by accident.
3. **Rebuild from the previous known-good commit** if you need an immediate
   replacement build:
   ```powershell
   git checkout <previous-good-sha>
   eas build --profile production --platform android --auto-submit-with-profile production
   git checkout main
   ```
4. **Investigate root cause** before re-attempting the swap. Common culprits:
   wrong anon key (RLS denies everything), migrations not applied to new prod
   DB, RevenueCat webhook still pointed at the dev project, Sentry DSN from the
   wrong org.

---

## Reference: what the guard catches

`lib/supabase.ts` runs `assertSupabaseEnvConfigured()` at module load. It
throws if `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY`:

- is empty / undefined, OR
- contains the literal substring `__SET_`, OR
- contains the literal substring `YOUR_PRODUCTION`, OR
- contains the literal substring `YOUR_STAGING`.

The dev + preview profiles ship real values, so they are unaffected. Only a
misconfigured production build trips the guard.
