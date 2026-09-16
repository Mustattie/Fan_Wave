# Deep Link Runbook — App Links / Universal Links

**Status**: association files and app routes shipped in v9.5.12. Android is
complete and verifiable today. **iOS is blocked on hosting** — see
"The iOS blocker" below. Nothing else is outstanding.

## The correction that unblocked this

The previous version of this runbook described the remaining work as
pending "on the fansphere.org repo" and sketched a Next.js implementation.
There is no such repo. **fansphere.org is served from `docs/` in THIS
repository** via GitHub Pages — `docs/CNAME` holds the domain, `docs/.nojekyll`
disables Jekyll so dot-directories like `.well-known/` publish verbatim, and
`docs/invite/` has been live there all along.

That same wrong assumption also stalled the email-confirmation fix until
v9.5.11. If a future task looks like "we need a web page for this", the page
goes in `docs/`.

## What ships where

| Path | In-app | On the web (no app installed) | Verified app link? |
|---|---|---|---|
| `/party/<uuid>` | `app/party/[id].tsx` → `/watch-party/[id]` | `docs/open/` | **Yes** |
| `/group/<uuid>` | `app/group/[id].tsx` → `/fan-group/[id]` | `docs/open/` | **Yes** |
| `/clip/<uuid>` | *none — no detail screen* | `docs/open/` | No |
| `/moment/<uuid>` | *none — no detail screen* | `docs/open/` | No |
| `/invite/<code>` | — | `docs/invite/` | No — deliberate |
| `/auth/` | — | `docs/auth/` | No — **must never be** |

GitHub Pages cannot resolve dynamic segments, so every one of these 404s and
`docs/404.html` re-dispatches it with the original path preserved as `?p=`.
That table is the routing table — `docs/404.html` and `docs/open/index.html`
both have to agree with it, and `ROUTED` in `open/index.html` must list only
types that have an app route, or the page renders an "Open in Fan Sphere"
button that lands in `+not-found`.

### Why `/auth/` is excluded, and must stay excluded

`docs/auth/index.html` only works as a *web* page: it reads the tokens
Supabase leaves in the URL fragment and forwards them to
`fansphere://auth-callback` itself. If a Universal Link captured `/auth/`,
iOS would open the app at a route named `/auth`, which does not exist — so
email confirmation would land in `+not-found` and the tokens would never be
exchanged. That is precisely the bug v9.5.11 fixed.

The AASA lists `/auth/*` as an explicit `"exclude": true` **first**, ahead of
the includes, so that a future edit adding a broad `"/": "/*"` cannot silently
re-break it. Android is safe by construction — its intent filter enumerates
`pathPrefix` values and `/auth/` is not among them.

### Why `/invite/` is excluded

An invite link's audience is people who do **not** have the app. The web page
shows the code and the store badges, and already offers its own "Open in Fan
Sphere" link for the minority who do.

### Why `/clip/` and `/moment/` are not verified

`lib/sharing.ts` generates both, but **no in-app destination exists** — there
is no clip detail screen and no moment detail screen. Verifying those paths
would make a tapped share link open the app into `+not-found`, which is worse
than the web page it replaced. They stay unverified until a viewer screen
exists, and `docs/open/` carries them in the meantime with real copy and store
CTAs instead of the marketing homepage they used to land on.

Building that screen is not a small job and should not ride along in a linking
change. `ClipCard` lives inside `app/(tabs)/clips.tsx`, takes 20 props, and is
bound to ClipsScreen's *shared* video-player architecture — `sharedPlayer`,
`isActive`, `isPlaying`, `onTogglePlay`, where exactly one card may hold a
`<VideoView>`. That design is the fix for a v8.6 P0 and a UAT flicker bug, both
documented in comments at the top of the file. A standalone clip screen means
either extracting `ClipCard` (refactoring a performance-sensitive file) or
re-implementing the player lifecycle (duplicating the logic that produced those
two bugs). Either belongs in its own change with its own UAT round.

## Deploying: `docs/` publishes from `main`, not from the release branch

```
gh api repos/Mustattie/Fan_Wave/pages --jq '.source'
# {"branch":"main","path":"/docs"}
```

Everything under `docs/` is inert until it reaches **main**. Work committed on
`v9.5` changes nothing about what fansphere.org serves, and `curl` will keep
returning 404 for it — which is exactly what
`https://fansphere.org/.well-known/assetlinks.json` and `/auth/` do as of this
commit.

Two consequences worth stating plainly:

1. **The site must be live before a build depends on it.** A build that
   redirects auth emails to `/auth/`, or claims App Links, will fail in the
   field if the pages have not merged to main first. Merge, `curl` to confirm,
   then build.
2. **`site_url` on prod Supabase already points at `/auth/`**, which is still a
   404. Nothing reaches it today — every send in the app passes an explicit
   allow-listed `redirectTo`, and no mailer template embeds `{{ .SiteURL }}`
   (all use `{{ .ConfirmationURL }}`) — so the fallback is unreachable rather
   than safe. It stops being a latent trap the moment `docs/` is on main.

## The iOS blocker

`apple-app-site-association` must be served with **no file extension** *and*
`Content-Type: application/json`. GitHub Pages serves extensionless files as
`application/octet-stream` and offers no per-file header control — there is no
`_headers` file, no config, no workaround at the Pages layer.

So `docs/.well-known/apple-app-site-association` is correct and committed, but
**iOS Universal Links will not verify while fansphere.org is served directly by
GitHub Pages.** Android is unaffected: `assetlinks.json` carries a `.json`
extension and is served as `application/json` automatically.

Fixing it means putting something in front that can set the header:

- **Cloudflare proxy** (recommended) — nameservers move to Cloudflare, GitHub
  Pages stays the origin, a Transform Rule sets the content type. URLs do not
  change. **Risk: the Resend email DNS (SPF via `send.fansphere.org`, DKIM, and
  the DMARC CNAME) must be migrated exactly, or auth email delivery breaks.**
  Verify every record with `dig` before and after the nameserver switch.
- **Vercel / Netlify** — full `headers` control, but the same DNS move.
- **Subdomain** — host only the association file elsewhere. Rejected: Apple
  fetches AASA from the exact domain in `associatedDomains` and follows no
  redirects, so this would mean changing `DEEP_LINK_BASE` and invalidating
  every link already shared.

## Fingerprints, and where they came from

`docs/.well-known/assetlinks.json` lists two SHA-256 certificate fingerprints.
Both are required and they are not interchangeable:

- `97:D5:56:A6:…:D1:BE:3A` — **Play App Signing certificate**. What Play
  re-signs with, so it is what every Play-installed app is verified against.
  Retrieved from the Play Developer API:
  `GET /androidpublisher/v3/applications/org.fansphere.app/generatedApks/{versionCode}`
  → `generatedApks[].certificateSha256Hash`, using `play-store-key.json`.
  Identical across version codes 2, 5 and 6. (Play Console → Test and release
  → Setup → App integrity shows the same value.)
- `84:DE:16:E9:…:C4:2E:AA:54` — **EAS upload/build keystore**. What signs the
  `preview` profile APKs that get sideloaded for on-device UAT. Retrieved from
  the EAS GraphQL API (`app.byId.androidAppCredentials`), key alias
  `33c7b528c86a351f93b524324b1cfb33`.

Do not try to read a fingerprint out of the APKs in `builds/` — those are
bundletool conversions signed with the local **debug** keystore
(`CN=Android Debug`), so they report an unrelated value.

## Verification

Android, after the next build reaches a device:

```sh
# 1. The file is reachable and typed correctly
curl -sI https://fansphere.org/.well-known/assetlinks.json | grep -i 'content-type\|HTTP/'
#    expect: HTTP/2 200 and content-type: application/json

# 2. Google's own verifier agrees
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?\
source.web.site=https://fansphere.org&\
relation=delegate_permission/common.handle_all_urls" | head -40

# 3. On device -- verification state per domain
adb shell pm get-app-links org.fansphere.app
#    expect: fansphere.org: verified

# 4. Force re-verification after changing assetlinks.json
adb shell pm verify-app-links --re-verify org.fansphere.app

# 5. End to end
adb shell am start -a android.intent.action.VIEW \
  -d "https://fansphere.org/party/<known-uuid>"
```

iOS, once the hosting change is in:

```sh
curl -sI https://fansphere.org/.well-known/apple-app-site-association \
  | grep -i 'content-type\|HTTP/'
#    expect: content-type: application/json  <-- the whole blocker, in one line
```

Then Safari → `https://fansphere.org/party/<uuid>` → should open the app.
Apple's CDN caches AASA aggressively; `swcutil dl -d fansphere.org` on a test
Mac forces a refetch. A device that has already cached a failed lookup may need
the app reinstalled.

Regression check that matters more than any of the above: **confirm a signup
email still opens `/auth/` in a browser and does not get captured by the app.**

## Analytics

`invite_opened` fires in both landing routes — `app/party/[id].tsx` with
`('invite_opened', 'party', { id })` and `app/group/[id].tsx` with
`('invite_opened', 'fan_group', { id })` — so installs can be attributed to
invite links post-hoc through the standard `analytics_events` flush.
