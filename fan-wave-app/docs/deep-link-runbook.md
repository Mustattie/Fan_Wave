# Deep Link Invite Flow — Runbook

**Status**: app-side prerequisites shipped in v9.4.0/uat-round3 (commit TODO).
Marketing-site work pending — this doc captures the exact changes needed
on the fansphere.org repo to complete the flow.

## What this fixes

UAT round 3 #3: SMS invites like `https://fansphere.org/party/<uuid>`
opened the marketing landing page (`/?p=%2F`), not the party details.
Kills the invite loop.

## App-side (already shipped)

- `app.json` iOS `associatedDomains: ["applinks:fansphere.org"]`
- `app.json` Android `intentFilters` with `autoVerify: true` on
  `https://fansphere.org/party/*`
- `app/party/[id].tsx` route that fires `invite_opened` analytics
  and redirects to the existing `/watch-party/[id]` detail screen.
- Custom scheme `fansphere://party/<uuid>` also works via expo-router's
  path matching, no separate handler needed.

## Marketing site — needed changes

### 1. `/.well-known/apple-app-site-association`

Serve **no extension**, `Content-Type: application/json`, over HTTPS.

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["D887TLA6L9.org.fansphere.app"],
        "components": [
          { "/": "/party/*", "comment": "Watch party invites" }
        ]
      }
    ]
  }
}
```

`D887TLA6L9` is the Thabtech LLC Apple Team ID (per memory). Verify
with `xcrun altool` or ASC → Membership before shipping.

### 2. `/.well-known/assetlinks.json`

Serve as `Content-Type: application/json`.

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "org.fansphere.app",
    "sha256_cert_fingerprints": [
      "TODO_UPLOAD_KEY_SHA256"
    ]
  }
}]
```

Get the SHA-256 fingerprint from Google Play Console →
Setup → App integrity → App signing key certificate → SHA-256 fingerprint.
Format is `XX:XX:XX:...` (colon-separated hex).

### 3. `/party/[id]` route (Next.js example)

Serves a public preview for **public** parties, install-gate for
**private** parties, and pushes install on both.

```tsx
// app/party/[id]/page.tsx (Next.js App Router)
import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

export default async function PartyPreview({ params }: { params: { id: string } }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data: party } = await supabase
    .from('watch_parties')
    .select('id, title, visibility, venue_name, venue_city, starts_at, host_id, ' +
            'host:users!host_id(display_name), game:games(*)')
    .eq('id', params.id)
    .maybeSingle();

  if (!party) redirect('/');

  const isPrivate = party.visibility === 'private';

  return (
    <main>
      <section className="hero">
        <h1>{isPrivate ? 'You’re invited to a private watch party' : party.title}</h1>
        {!isPrivate && (
          <>
            <p>📍 {party.venue_name} · {party.venue_city}</p>
            <p>🗓 {new Date(party.starts_at).toLocaleString()}</p>
            <p>Hosted by {party.host?.display_name ?? 'a Fan Sphere host'}</p>
          </>
        )}
        {isPrivate && (
          <p>Install Fan Sphere to RSVP.</p>
        )}
      </section>
      <section className="cta">
        <a href="fansphere://party/{party.id}" className="btn primary">
          Open in App
        </a>
        <a href="https://apps.apple.com/app/id6774325670" className="btn secondary">
          Get on App Store
        </a>
        <a href="https://play.google.com/store/apps/details?id=org.fansphere.app" className="btn secondary">
          Get on Google Play
        </a>
      </section>
    </main>
  );
}
```

The `fansphere://party/<uuid>` link triggers the app's custom scheme
handler when installed — no Universal Link redirect race. If the app
isn't installed, the browser silently no-ops on the scheme and the user
falls through to the store buttons.

## Verification (after marketing site ships)

1. iOS — Safari → `https://fansphere.org/party/<known-uuid>` → prompt
   "Open in Fan Sphere?" → tap → app opens on the watch-party screen.
2. iOS — from Messages, tap a real SMS invite → same result.
3. Android — Chrome → same URL → auto-opens the app if intent filter
   verified (Digital Asset Links). Otherwise shows a chooser.
4. Web only (browser without app) → renders the preview page,
   install CTAs visible.
5. Cache-invalidation: iOS Universal Links cache the AASA for weeks.
   If updating AASA, use `swcutil dl -d fansphere.org` on a test Mac
   to force refetch.

## Analytics

`invite_opened` fires in `app/party/[id].tsx` with `{ id: '<uuid>' }`.
Route it through the standard `analytics_events` flush so we can
attribute installs to invite links post-hoc.
