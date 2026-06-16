-- 053: Reviewer-account bypass + free-tier soft-paywall design.
--
-- WHY this migration exists:
--   Migration 033 layered has_premium_access() into the WITH CHECK of every
--   write policy (chat_rooms, chat_room_members, messages, watch_parties,
--   watch_party_rsvps, media_clips, match_moments, user_team_follows). This
--   means any user with subscription_status='none' is denied at the DB layer
--   for ALL writes — they can't even join a public group, RSVP a party, or
--   send a chat message in a group they're already in.
--
--   The launch experience hid this because every signup auto-trialled into
--   'trial' status. When we flipped the Apple-review test account
--   (fansphere.reviewer@gmail.com) to subscription_status='none' so Apple
--   could see the IAPs, the reviewer became a "real" free user and was
--   instantly locked out of every create flow. Symptoms reported 2026-06-10:
--     - Create fan group → generic "Could not create" error
--     - Create watch party (Soccer Cup tab) → "Could not create" error
--     - Post clip → Premium paywall slides up (PaywallGate caught it)
--     - Send chat in a joined group → message disappears
--     - Buy Soccer Cup Pass → "Purchase could not start" (separate RC issue)
--
-- WHAT this migration changes:
--   1. has_premium_access() and has_wc_access() gain an allow-list bypass
--      keyed off auth.users.email so review accounts can exercise the full
--      create surface while still seeing paywall UI when they navigate to
--      Subscription manually. This is auditable in one place — no scattered
--      UUIDs, no per-screen `if (email === ...)` shortcuts.
--   2. Free-tier users get a SOFT paywall on chat_rooms creation: they can
--      create their FIRST group lifetime (the funnel hook), then must
--      upgrade. The same soft-quota pattern can be added to watch_parties /
--      media_clips later, but for v7 we keep those hard-gated to Premium.
--   3. Joining public groups, sending chat messages, RSVPing watch parties,
--      and following teams are FREE — these are the discover-the-app loops
--      and gating them at the DB makes the freemium funnel non-functional.
--      Premium remains required for creating watch parties and posting clips
--      / moments, since those are the actual premium value props.
--
-- WHAT this migration does NOT change:
--   - watch_parties_insert        (still requires Premium)
--   - media_clips_insert          (still requires Premium)
--   - match_moments_insert        (still requires Premium)
--   - All WC-event-id branches    (still require has_wc_access())
--   - Migrations 032, 033, 051    (kept as-is; this layers on top)
--
-- SAFETY: every helper here is SECURITY DEFINER STABLE with explicit
-- search_path, matching the pattern from migration 051. No RLS recursion
-- can be re-introduced because the bypass reads auth.users (which has no
-- RLS the way we use it) and the free-tier quota reads chat_rooms.owner_id
-- only — neither path re-enters chat_room_members.

-- ─── 1. Reviewer-account allow-list ────────────────────────────────
-- Single source of truth for "is this user a reviewer / QA account."
-- Apple / Google review accounts go here. Email match is exact, case-
-- insensitive. Keep the list short (≤5 entries) — this is not a tier
-- system, it's a launch-window workaround.

CREATE OR REPLACE FUNCTION public.is_reviewer_account(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = uid
      AND lower(email) IN (
        'fansphere.reviewer@gmail.com',
        'reviewer@fansphere.org'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_reviewer_account(UUID) TO authenticated;

COMMENT ON FUNCTION public.is_reviewer_account(UUID) IS
  'Returns TRUE if the user is on the App-Store / Play-Store review allow-list. Used to grant full create-flow access to reviewer accounts that are otherwise free-tier so they can validate every flow. See migration 053.';

-- ─── 2. has_premium_access — overload to include reviewer bypass ───
-- Same fail-closed semantics as 032; OR in the reviewer check.

CREATE OR REPLACE FUNCTION public.has_premium_access(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = uid
      AND u.subscription_status IN ('trial', 'active')
      AND u.premium_active_until IS NOT NULL
      AND u.premium_active_until > now()
  )
  OR public.is_reviewer_account(uid);
$$;

-- ─── 3. has_wc_access — overload to include reviewer bypass ────────

CREATE OR REPLACE FUNCTION public.has_wc_access(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = uid
      AND (
        (u.subscription_status = 'trial'
         AND u.premium_active_until IS NOT NULL
         AND u.premium_active_until > now())
        OR (u.wc_pass_active_until IS NOT NULL
            AND u.wc_pass_active_until > now())
      )
  )
  OR public.is_reviewer_account(uid);
$$;

-- ─── 4. Free-tier "first group is free" quota ──────────────────────
-- A new free user can create their first fan group; subsequent creates
-- hit the Premium paywall. This is the freemium hook described in our
-- payment design doc — the first group is the magic moment that gets
-- people to invite friends; the second is what they pay for.
--
-- NOTE: counts groups the user OWNS (created), not groups they joined.

CREATE OR REPLACE FUNCTION public.free_tier_can_create_group(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    SELECT COUNT(*) FROM public.chat_rooms WHERE owner_id = uid
  ) = 0;
$$;

GRANT EXECUTE ON FUNCTION public.free_tier_can_create_group(UUID) TO authenticated;

-- ─── 5. chat_rooms — rewrite INSERT to allow free-tier first group ─
-- WC groups still require has_wc_access (which now includes reviewer).

DROP POLICY IF EXISTS chat_rooms_insert ON public.chat_rooms;
CREATE POLICY chat_rooms_insert ON public.chat_rooms
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      public.has_premium_access(auth.uid())
      OR public.free_tier_can_create_group(auth.uid())
    )
    AND (
      group_type IS DISTINCT FROM 'worldcup'
      OR public.has_wc_access(auth.uid())
    )
  );

-- ─── 6. chat_room_members — joining a PUBLIC group is FREE ─────────
-- 051's policy required has_premium_access to JOIN — that breaks the
-- freemium funnel (free users can't even browse-and-join). Keep the WC
-- gate (WC groups remain pass-only), drop the blanket premium check on
-- public-group joins.
--
-- Owners can still insert themselves on room creation (via the OR
-- branch). Admin path preserved.

DROP POLICY IF EXISTS chat_room_members_insert ON public.chat_room_members;
CREATE POLICY chat_room_members_insert ON public.chat_room_members
  FOR INSERT TO authenticated WITH CHECK (
    (
      user_id = auth.uid()
      AND public.chat_room_visibility(chat_room_id) = 'public'
      AND (
        public.chat_room_group_type(chat_room_id) IS DISTINCT FROM 'worldcup'
        OR public.has_wc_access(auth.uid())
      )
    )
    OR public.is_chat_room_owner(chat_room_id, auth.uid())
    OR public.is_admin()
  );

-- ─── 7. messages — sending chat in a joined group is FREE ──────────
-- Membership check is already enforced (must already be a member); the
-- premium check on top was double-gating the same freemium funnel.

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND public.is_chat_room_member(chat_room_id, auth.uid())
  );

-- ─── 8. watch_party_rsvps — RSVPing is FREE (WC parties still gated) ─

DROP POLICY IF EXISTS watch_party_rsvps_insert ON public.watch_party_rsvps;
CREATE POLICY watch_party_rsvps_insert ON public.watch_party_rsvps
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      (SELECT wp.event_id FROM public.watch_parties wp WHERE wp.id = watch_party_id)
        IS DISTINCT FROM 'e0000000-0000-0000-0000-000000002026'::UUID
      OR public.has_wc_access(auth.uid())
    )
  );

-- ─── 9. user_team_follows — following a team is FREE ───────────────
-- (WC national teams still require WC access, preserved from 033.)

DROP POLICY IF EXISTS "Users can insert own follows" ON public.user_team_follows;
CREATE POLICY "Users can insert own follows" ON public.user_team_follows
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      (SELECT t.league_id FROM public.teams t WHERE t.id = team_id)
        IS DISTINCT FROM 'b0000000-0000-0000-0000-000000000026'::UUID
      OR public.has_wc_access(auth.uid())
    )
  );

-- ─── Verification ──────────────────────────────────────────────────
-- Apply, then sanity check from psql / Supabase SQL editor:
--
--   -- Reviewer should now pass
--   SELECT public.has_premium_access(
--     (SELECT id FROM auth.users WHERE lower(email) = 'fansphere.reviewer@gmail.com')
--   );
--   -- expect: TRUE
--
--   -- Brand new free user should still be free for create-group #1
--   SELECT public.free_tier_can_create_group('<new-user-auth-uid>'::UUID);
--   -- expect: TRUE  (zero groups owned yet)
--
--   -- After creating a group, should flip to FALSE
--   SELECT public.free_tier_can_create_group('<new-user-auth-uid>'::UUID);
--   -- expect: FALSE
--
--   -- The owner-insert path for chat_room_members must still work after
--   -- the bouncer is dropped — verify by attempting to create a group
--   -- as a free user via the app and confirming the owner row lands.

NOTIFY pgrst, 'reload schema';
