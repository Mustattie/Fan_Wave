-- =====================================================================
-- Fan Sphere v9.4.2 UAT Round 4 Hotfix Bundle
-- =====================================================================
-- Applies migrations 067..084 that never landed on prod
-- (fwlfiejvxmslkpoojggs). Symptoms from UAT round 4 that trace here:
--
--   * "Could not find the function public.get_or_create_game_chat"
--     Game Day tab → Live chat  → migration 067
--   * "Could not find the function public.cast_mvp_vote"
--     Game Day tab → MVP vote   → migration 068
--   * "Could not find the function public.rsvp_to_watch_party"
--     Discover / Home → RSVP    → migration 073 (+ 074)
--   * WNBA teams missing in Create Fan Group team search
--     → migrations 075 + 077 + 078 (WNBA sport row + backfill)
--   * Watch Party attendee count/affinity confusion
--     → migration 084 host-aware attendees RPC
--
-- Every source file below is idempotent (uses IF NOT EXISTS / ON
-- CONFLICT / CREATE OR REPLACE). Safe to re-run.
--
-- How to apply:
--   1. Supabase Studio → SQL Editor
--   2. Paste the entire contents of this file
--   3. Run
--   4. Verify with the SELECT block at the bottom
-- =====================================================================



-- ═══════════════════════════════════════════════════════════════════════
-- 067_game_chat_rooms.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 067: Per-game live chat rooms (v9.1 head start)
--
-- Adds first-class support for a live chat room bound to a single
-- public.games row. Reaches the app via the "Live chat" CTA on
-- app/game/[id].tsx — one tap creates-or-opens the room, auto-adds the
-- caller as a member, then routes to the existing chat UI at
-- app/fan-group/[id].tsx. Zero new chat UI needed — game rooms ride the
-- same messages / realtime / RLS stack that fan groups already use.
--
-- Schema deltas:
--   * chat_rooms.game_id  UUID  REFERENCES games(id) ON DELETE SET NULL
--     Nullable. Non-null only on game_chat rooms.
--   * group_type CHECK extended with 'game_chat'.
--   * Partial UNIQUE INDEX on game_id (WHERE game_id IS NOT NULL) so a
--     race between two users tapping Live Chat simultaneously results
--     in one row, not two.
--
-- Idempotent — safe to replay.

-- Column ------------------------------------------------------------------
ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES public.games(id) ON DELETE SET NULL;

-- Group-type CHECK --------------------------------------------------------
-- The constraint was inline in migration 002 without an explicit name, so
-- Postgres named it chat_rooms_group_type_check. Drop-if-exists + re-add.
ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_group_type_check;
ALTER TABLE public.chat_rooms
  ADD  CONSTRAINT chat_rooms_group_type_check
       CHECK (group_type IN ('sports','worldcup','general','game_chat'));

-- One-room-per-game guard -------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_game_id_unique
  ON public.chat_rooms (game_id)
  WHERE game_id IS NOT NULL;

-- RPC: get_or_create_game_chat(p_game_id UUID) RETURNS UUID ---------------
--
-- SECURITY DEFINER so it can INSERT into chat_rooms / chat_room_members
-- without depending on the caller's RLS. Returns the chat_room_id in all
-- cases (existing room, freshly created room, or race-lost creation).
-- Auto-adds the caller as a member so they can post messages under the
-- existing chat_room_members_insert policy (v9.0 already treats members
-- as writers; this room type inherits that automatically).
CREATE OR REPLACE FUNCTION public.get_or_create_game_chat(p_game_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id     UUID;
  v_home_name   TEXT;
  v_away_name   TEXT;
  v_room_name   TEXT;
  v_auth_uid    UUID := auth.uid();
BEGIN
  IF p_game_id IS NULL THEN
    RAISE EXCEPTION 'game_id required';
  END IF;

  -- Fast path: room already exists.
  SELECT id INTO v_room_id
    FROM public.chat_rooms
   WHERE game_id = p_game_id;

  IF v_room_id IS NULL THEN
    -- Build "Home vs Away" room name from teams. Falls back to "Live game
    -- chat" if either team lookup returns NULL (shouldn't happen but
    -- shielding against seed rows with NULL team_ids from mig 006).
    SELECT ht.name, at.name
      INTO v_home_name, v_away_name
      FROM public.games g
      LEFT JOIN public.teams ht ON ht.id = g.home_team_id
      LEFT JOIN public.teams at ON at.id = g.away_team_id
     WHERE g.id = p_game_id;

    v_room_name := COALESCE(v_home_name, 'Home') || ' vs ' || COALESCE(v_away_name, 'Away');

    -- Insert-or-return under the UNIQUE(game_id) index. If two callers
    -- race, one wins the insert and the other's ON CONFLICT re-reads.
    INSERT INTO public.chat_rooms (
      name,
      description,
      group_type,
      game_id,
      visibility,
      owner_id,
      member_count
    ) VALUES (
      v_room_name,
      'Live chat for this game. Kickoff-only banter, no moderation history.',
      'game_chat',
      p_game_id,
      'public',
      -- System owner (existing pattern from mig 006 WC seed groups).
      '00000000-0000-0000-0000-000000000000'::uuid,
      0
    )
    ON CONFLICT (game_id) WHERE game_id IS NOT NULL
    DO UPDATE SET name = EXCLUDED.name  -- no-op to force RETURNING to fire
    RETURNING id INTO v_room_id;
  END IF;

  -- Auto-join the caller. Ignored if already a member (UNIQUE constraint
  -- on chat_room_members from mig 002).
  IF v_auth_uid IS NOT NULL THEN
    INSERT INTO public.chat_room_members (chat_room_id, user_id, role)
    VALUES (v_room_id, v_auth_uid, 'member')
    ON CONFLICT (chat_room_id, user_id) DO NOTHING;
  END IF;

  RETURN v_room_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_game_chat(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_or_create_game_chat(UUID) TO authenticated;

-- Verify with:
--   SELECT public.get_or_create_game_chat('<game_uuid>'); -- returns room id
--   SELECT id, name, group_type, game_id, visibility
--     FROM public.chat_rooms WHERE group_type = 'game_chat' LIMIT 5;


-- ═══════════════════════════════════════════════════════════════════════
-- 068_mvp_votes.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 068: MVP voting per game (v9.1)
--
-- One vote per (user, game). Voting is team-scoped, not player-scoped, because
-- there is no players table today and building an ESPN player ingest would
-- balloon v9.1. Team-level voting is still meaningful in aggregate ("72% of
-- fans think MVP came from the Chiefs") and the schema leaves room to add a
-- nullable player_id column later without breaking the RPC contract.
--
-- Surfaced in the app via the "MVP vote" CTA on app/game/[id].tsx which opens
-- MvpVoteSheet (the two-team picker + tally bar). No time gating -- fans can
-- cast a predictive vote before kickoff and change it up through the final
-- whistle; the RPC upserts.
--
-- Idempotent -- safe to replay.

-- Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mvp_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mvp_votes_one_per_user_game UNIQUE (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS mvp_votes_game_id_idx ON public.mvp_votes (game_id);
CREATE INDEX IF NOT EXISTS mvp_votes_user_id_idx ON public.mvp_votes (user_id);

-- RLS ---------------------------------------------------------------------
ALTER TABLE public.mvp_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mvp_votes_select_all       ON public.mvp_votes;
DROP POLICY IF EXISTS mvp_votes_insert_own       ON public.mvp_votes;
DROP POLICY IF EXISTS mvp_votes_update_own       ON public.mvp_votes;
DROP POLICY IF EXISTS mvp_votes_delete_own       ON public.mvp_votes;

CREATE POLICY mvp_votes_select_all ON public.mvp_votes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY mvp_votes_insert_own ON public.mvp_votes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY mvp_votes_update_own ON public.mvp_votes
  FOR UPDATE TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY mvp_votes_delete_own ON public.mvp_votes
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- RPC: cast_mvp_vote(p_game_id, p_team_id) --------------------------------
--
-- Upserts the caller's vote for this game and validates that team_id is one
-- of the two teams playing (defends against a client sending an arbitrary
-- team_id and skewing tallies for an unrelated game).
--
-- Returns the caller's stored team_id post-upsert.
CREATE OR REPLACE FUNCTION public.cast_mvp_vote(
  p_game_id UUID,
  p_team_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid   UUID := auth.uid();
  v_home_id    UUID;
  v_away_id    UUID;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_game_id IS NULL OR p_team_id IS NULL THEN
    RAISE EXCEPTION 'game_id and team_id required';
  END IF;

  SELECT home_team_id, away_team_id INTO v_home_id, v_away_id
    FROM public.games WHERE id = p_game_id;

  IF v_home_id IS NULL AND v_away_id IS NULL THEN
    RAISE EXCEPTION 'game not found';
  END IF;
  IF p_team_id <> v_home_id AND p_team_id <> v_away_id THEN
    RAISE EXCEPTION 'team is not playing in this game';
  END IF;

  INSERT INTO public.mvp_votes (game_id, user_id, team_id)
  VALUES (p_game_id, v_auth_uid, p_team_id)
  ON CONFLICT (game_id, user_id)
  DO UPDATE SET team_id = EXCLUDED.team_id,
                updated_at = now();

  RETURN p_team_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cast_mvp_vote(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cast_mvp_vote(UUID, UUID) TO authenticated;

-- RPC: get_mvp_tally(p_game_id) -------------------------------------------
--
-- Returns aggregated counts + the caller's own vote in one round-trip so the
-- client can render the bar + highlight the selected side without a second
-- query. Uses the same defensive team lookup so an unknown game_id returns
-- zeros rather than throwing.
CREATE OR REPLACE FUNCTION public.get_mvp_tally(p_game_id UUID)
RETURNS TABLE (
  home_team_id  UUID,
  away_team_id  UUID,
  home_votes    BIGINT,
  away_votes    BIGINT,
  my_vote       UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    g.home_team_id,
    g.away_team_id,
    COALESCE(SUM(CASE WHEN v.team_id = g.home_team_id THEN 1 ELSE 0 END), 0) AS home_votes,
    COALESCE(SUM(CASE WHEN v.team_id = g.away_team_id THEN 1 ELSE 0 END), 0) AS away_votes,
    (SELECT team_id FROM public.mvp_votes
      WHERE game_id = p_game_id AND user_id = v_auth_uid
      LIMIT 1) AS my_vote
  FROM public.games g
  LEFT JOIN public.mvp_votes v ON v.game_id = g.id
  WHERE g.id = p_game_id
  GROUP BY g.id, g.home_team_id, g.away_team_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_mvp_tally(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_mvp_tally(UUID) TO authenticated;

-- Verify with:
--   SELECT public.cast_mvp_vote('<game_uuid>', '<team_uuid>');
--   SELECT * FROM public.get_mvp_tally('<game_uuid>');


-- ═══════════════════════════════════════════════════════════════════════
-- 069_cfb_league_and_team_upsert.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 069: Add College Football league + enable ESPN team auto-upsert (v9.1)
--
-- v9.1 turns ESPN CFB on. FBS is ~134 programs -- too many to hand-seed via
-- a static migration and impossible to keep current as programs move
-- conferences. Instead, we let sync-game-schedules auto-upsert teams from
-- the ESPN scoreboard payload the first time it sees them. This is the
-- general answer for every future sport add (WNBA in v9.2, CBB later, etc.).
--
-- What this migration does:
--   1. Seed the College Football league row (sport already exists from
--      mig 007). The sync function looks it up by leagueName ILIKE match.
--   2. Add UNIQUE (league_id, name) on teams so the upsert-on-conflict
--      path from the edge function is race-safe.
--
-- The league row uses a deterministic UUID in the same b0000000 namespace
-- as mig 001, next slot after Premier League (007) = 008.
--
-- Idempotent -- safe to replay.

INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000008',
   'a0000000-0000-0000-0000-000000000007',  -- College Football sport (mig 007)
   'College Football',
   'USA',
   '🏈')
ON CONFLICT (id) DO NOTHING;

-- Enforce uniqueness per league so the sync's INSERT ... ON CONFLICT
-- (league_id, name) DO UPDATE upsert is well-defined. Named constraint so
-- future migrations can reference it explicitly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'teams_league_id_name_key'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_league_id_name_key UNIQUE (league_id, name);
  END IF;
END $$;

-- Verify with:
--   SELECT id, name FROM public.leagues WHERE name = 'College Football';
--   SELECT conname FROM pg_constraint WHERE conname = 'teams_league_id_name_key';


-- ═══════════════════════════════════════════════════════════════════════
-- 070_open_creation_flows.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 070: Drop premium gates on creation flows (v9.1 UAT pivot)
--
-- WHY:
--   UAT feedback 2026-07-18: "These pymt screens are supposed to come up
--   upon signing in, not when one is trying to create a fan group or watch
--   party" + "What does this mean, not understanding" (on the Premium-
--   required-to-join-groups alert). The product owner is repositioning
--   the paywall from mid-app friction to a one-time onboarding CTA
--   (already exists at app/(auth)/choose-plan.tsx) plus a permanent
--   Profile subscription CTA (already exists at app/subscription.tsx).
--
--   Mig 053 already opened up JOIN + RSVP + FOLLOW + MESSAGE as free-
--   tier. But it left creation flows (chat_rooms beyond the first, watch
--   parties, media_clips, match_moments) hard-gated behind
--   has_premium_access(). The client caught the 42501 and popped a
--   paywall, which the user is now telling us to remove.
--
-- WHAT this changes (idempotent):
--   1. chat_rooms_insert       — drop has_premium_access + free-tier quota;
--                                any authenticated user may create groups.
--   2. watch_parties_insert    — drop has_premium_access.
--   3. media_clips_insert      — drop has_premium_access.
--   4. match_moments_insert    — drop has_premium_access.
--
-- What stays gated:
--   * WC-league branches on watch_parties_insert / watch_party_rsvps_insert
--     / user_team_follows still require has_wc_access — WC content stays
--     WC-Pass-only per the grandfathering plan. (v9.x plan is to sunset WC
--     entirely; that's a separate later migration.)
--   * chat_room_members_insert to WC groups still requires has_wc_access
--     (set in mig 053 already).
--
-- Reviewer bypass (mig 053) remains untouched — no cost to keep it as
-- defense-in-depth even though the gates are gone.
--
-- After apply: PostgREST schema reload so the client sees fresh policies.

-- ─── 1. chat_rooms_insert — fully open to authenticated ────────────
-- Owner must still match auth.uid(). WC-typed groups continue to
-- require WC access (v9.x sunset is a later migration, not this one).
DROP POLICY IF EXISTS chat_rooms_insert ON public.chat_rooms;
CREATE POLICY chat_rooms_insert ON public.chat_rooms
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (
      group_type IS DISTINCT FROM 'worldcup'
      OR public.has_wc_access(auth.uid())
    )
  );

-- ─── 2. watch_parties_insert — free tier can host parties ──────────
DROP POLICY IF EXISTS watch_parties_insert ON public.watch_parties;
CREATE POLICY watch_parties_insert ON public.watch_parties
  FOR INSERT TO authenticated
  WITH CHECK (
    creator_id = auth.uid()
    AND (
      event_id IS DISTINCT FROM 'e0000000-0000-0000-0000-000000002026'::UUID
      OR public.has_wc_access(auth.uid())
    )
  );

-- ─── 3. media_clips_insert — free tier can post clips ──────────────
DROP POLICY IF EXISTS media_clips_insert ON public.media_clips;
CREATE POLICY media_clips_insert ON public.media_clips
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
  );

-- ─── 4. match_moments_insert — free tier can post moments ──────────
-- WC-group moments still require WC access (mirror of the joined-group
-- pattern from mig 053). Membership check preserved from mig 033.
DROP POLICY IF EXISTS match_moments_insert ON public.match_moments;
CREATE POLICY match_moments_insert ON public.match_moments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      (SELECT cr.group_type FROM public.chat_rooms cr WHERE cr.id = chat_room_id)
        IS DISTINCT FROM 'worldcup'
      OR public.has_wc_access(auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   -- Free user (subscription_status='none', not reviewer) should now succeed:
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims TO '{"sub":"<free-user-auth-uid>"}';
--   INSERT INTO public.chat_rooms(name, owner_id, group_type, visibility, member_count)
--     VALUES ('Test group', '<free-user-auth-uid>'::UUID, 'general', 'public', 1);
--   -- expect: 1 row inserted


-- ═══════════════════════════════════════════════════════════════════════
-- 071_sunset_wc_gates.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 071: Sunset World Cup RLS gates (v9.1 UAT correction)
--
-- WHY:
--   v9.1 UAT 2026-07-18: user tapped Join on a Suggested fan group and
--   hit "Could not join. Please try again." Root cause: the Suggested
--   list surfaced worldcup-typed groups (French national team etc. from
--   mig 006/064 seed), and mig 053's chat_room_members_insert policy
--   still requires has_wc_access(auth.uid()) for group_type='worldcup'.
--   Free-tier user without a WC Pass hits 42501.
--
--   Per project_v9_pivot.md, WC is being fully wound down as a distinct
--   product. Mig 070 already opened creation flows; this migration
--   removes the remaining WC branches from the FREE-TIER access paths
--   (join public group, RSVP watch party, follow team). The result: WC
--   content becomes ordinary soccer content, gated only by the same
--   rules as any other soccer group / league.
--
--   NB: mig 065 grandfathered WC Pass holders into +90d Premium, so
--   there's no user-facing regression — nobody who paid loses value.
--
-- WHAT this changes (idempotent):
--   1. chat_room_members_insert  — drop the worldcup branch, keep the
--                                  public-visibility check.
--   2. watch_party_rsvps_insert  — drop the WC event UUID branch.
--   3. user_team_follows insert  — drop the WC league UUID branch.
--
-- Reviewer bypass (mig 053) preserved for defense-in-depth. WC UI is
-- separately filtered on the client (v9.0 tab removal, v9.1 Discover
-- Suggested filter added same slice as this migration).

DROP POLICY IF EXISTS chat_room_members_insert ON public.chat_room_members;
CREATE POLICY chat_room_members_insert ON public.chat_room_members
  FOR INSERT TO authenticated WITH CHECK (
    (
      user_id = auth.uid()
      AND public.chat_room_visibility(chat_room_id) = 'public'
    )
    OR public.is_chat_room_owner(chat_room_id, auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS watch_party_rsvps_insert ON public.watch_party_rsvps;
CREATE POLICY watch_party_rsvps_insert ON public.watch_party_rsvps
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own follows" ON public.user_team_follows;
CREATE POLICY "Users can insert own follows" ON public.user_team_follows
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- Verify with (as a free user with subscription_status='none'):
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims TO '{"sub":"<free-user-auth-uid>"}';
--   -- WC group: France Fans (name pattern from mig 006 seed)
--   INSERT INTO public.chat_room_members(chat_room_id, user_id, role)
--     SELECT id, '<free-user-auth-uid>'::UUID, 'member'
--       FROM public.chat_rooms WHERE group_type = 'worldcup' LIMIT 1;
--   -- expect: 1 row inserted (previously 42501)


-- ═══════════════════════════════════════════════════════════════════════
-- 072_messages_media_columns.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 072: Add media columns to messages for WhatsApp-style unified chat feed
--
-- WHY:
--   v9.1 UAT 2026-07-18 (repeated): "having Chat and Highlights maybe
--   confusing, lets just have a chat like WhatsApp where users can all
--   chat and post videos on the same channel."
--
--   Prior model: text lived in `messages`, image/video "moments" lived in
--   `match_moments` accessed through a separate Highlights tab in
--   app/fan-group/[id].tsx. This migration lets `messages` carry media
--   inline, so the client can merge both tables (or, eventually, retire
--   match_moments entirely) into a single WhatsApp-like feed.
--
-- WHAT this changes (idempotent):
--   1. messages gains: media_url, thumbnail_url, media_type,
--      duration_seconds, clip_id (nullable FK to media_clips for the case
--      where a chat post is dual-written to the global Clips feed).
--   2. Widens messages.type CHECK to include 'clip'.
--
-- What this migration does NOT do:
--   * No data migration from match_moments → messages. Existing moments
--     stay in place; the client merges the two on read. A later slice can
--     backfill if we decide to fully deprecate match_moments.
--   * No RPC. Client posts to messages directly (RLS from mig 053 already
--     allows chat_room_members to INSERT rows).

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_url        TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url    TEXT,
  ADD COLUMN IF NOT EXISTS media_type       TEXT
    CHECK (media_type IS NULL OR media_type IN ('video','image')),
  ADD COLUMN IF NOT EXISTS duration_seconds INT,
  ADD COLUMN IF NOT EXISTS clip_id          UUID REFERENCES public.media_clips(id) ON DELETE SET NULL;

-- Widen the type enum. Drop-and-re-add is the safe pattern in Postgres
-- (mig 067 used the same). Preserve the pre-existing check values.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages ADD  CONSTRAINT messages_type_check
  CHECK (type IN ('text','image','video','moment','clip'));

-- Index the created_at DESC used by the paginated feed reader; multi-column
-- index against chat_room_id lets the reader scan a single room efficiently.
CREATE INDEX IF NOT EXISTS idx_messages_room_created_desc
  ON public.messages (chat_room_id, created_at DESC);

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='messages'
--       AND column_name IN ('media_url','thumbnail_url','media_type','duration_seconds','clip_id');


-- ═══════════════════════════════════════════════════════════════════════
-- 073_rsvp_rpc_delete_on_cancel.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 073: v9.1 UAT — RSVP RPC hardening (delete-on-cancel + count reconciliation)
--
-- BUG (UAT 2026-07-18)
-- ────────────────────
-- User tapped RSVP on a watch party. Local UI flipped to "Going" but two
-- server-backed surfaces stayed stale:
--   (a) Home → Watch Parties Near You card still shows old going count
--   (b) Profile → RSVP History still shows "No watch parties on your
--       calendar yet"
--
-- ROOT CAUSE
-- ──────────
-- Migration 063's rsvp_to_watch_party() converts p_status='cancelled' →
-- 'none' before INSERT, but watch_party_rsvps.status CHECK constraint
-- (migration 002 line 71) only allows ('going','interested','declined').
-- The insert fails with a 23514 check-constraint violation, transaction
-- rolls back, rsvp_count never updates, no row exists to list in history.
--
-- The client (WatchPartyCard.tsx) treats the RPC as fire-and-forget for
-- optimistic UI — so the button flips regardless of server outcome.
-- Everything else that reads the table is empty.
--
-- FIX
-- ───
-- Rewrite the RPC to DELETE the row when p_status is 'cancelled' / 'none'
-- rather than trying to store a placeholder status. RSVP history query at
-- app/rsvp-history.tsx naturally excludes cancelled RSVPs this way, and
-- rsvp_count recompute reflects reality.
--
-- Also: keep the constraint tight (only real statuses) so future code
-- can't insert junk values.

BEGIN;

DROP FUNCTION IF EXISTS public.rsvp_to_watch_party(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.rsvp_to_watch_party(UUID, TEXT);

CREATE FUNCTION public.rsvp_to_watch_party(
  p_party_id UUID,
  p_status   TEXT
)
RETURNS public.watch_party_rsvps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_event_id   UUID;
  v_capacity   INT;
  v_rsvp_count INT;
  v_rsvp       public.watch_party_rsvps;
  v_is_cancel  BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('going', 'interested', 'declined', 'none', 'cancelled') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  v_is_cancel := p_status IN ('none', 'cancelled');

  SELECT wp.event_id, wp.capacity, wp.rsvp_count
    INTO v_event_id, v_capacity, v_rsvp_count
    FROM public.watch_parties wp
   WHERE wp.id = p_party_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'watch party not found' USING ERRCODE = '42P01';
  END IF;

  -- WC pass gate — only applied to affirmative RSVPs on WC watch parties.
  IF v_event_id = 'e0000000-0000-0000-0000-000000002026'::UUID
     AND p_status IN ('going', 'interested')
     AND NOT public.has_wc_access(v_user_id) THEN
    RAISE EXCEPTION 'wc_pass_required' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'going' AND v_rsvp_count IS NOT NULL
     AND v_capacity IS NOT NULL AND v_rsvp_count >= v_capacity THEN
    RAISE EXCEPTION 'Watch party is at capacity' USING ERRCODE = '53400';
  END IF;

  IF v_is_cancel THEN
    -- Cancel = remove the row. History queries filter on user_id, so
    -- an absent row is the correct representation of "not attending".
    DELETE FROM public.watch_party_rsvps
     WHERE watch_party_id = p_party_id AND user_id = v_user_id
     RETURNING * INTO v_rsvp;
    -- If no row existed we still return a synthetic empty record so the
    -- client's .single() call doesn't 406.
    IF NOT FOUND THEN
      v_rsvp.id             := gen_random_uuid();
      v_rsvp.watch_party_id := p_party_id;
      v_rsvp.user_id        := v_user_id;
      v_rsvp.status         := 'declined';
      v_rsvp.created_at     := now();
    END IF;
  ELSE
    INSERT INTO public.watch_party_rsvps (watch_party_id, user_id, status)
    VALUES (p_party_id, v_user_id, p_status)
    ON CONFLICT (watch_party_id, user_id)
      DO UPDATE SET status = EXCLUDED.status
    RETURNING * INTO v_rsvp;
  END IF;

  -- Recompute the denormalized going count from truth. Cheap because
  -- watch_party_rsvps is indexed on (watch_party_id).
  UPDATE public.watch_parties
     SET rsvp_count = (
       SELECT count(*) FROM public.watch_party_rsvps
        WHERE watch_party_id = p_party_id AND status = 'going'
     )
   WHERE id = p_party_id;

  RETURN v_rsvp;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT) TO service_role;

-- One-time reconciliation: any watch_parties row whose rsvp_count
-- drifted from truth (because prior 'cancelled'→'none' inserts silently
-- failed) gets snapped to reality.
UPDATE public.watch_parties wp
   SET rsvp_count = COALESCE(sub.c, 0)
  FROM (
    SELECT watch_party_id, count(*) AS c
      FROM public.watch_party_rsvps
     WHERE status = 'going'
     GROUP BY watch_party_id
  ) sub
 WHERE wp.id = sub.watch_party_id
   AND wp.rsvp_count IS DISTINCT FROM sub.c;

UPDATE public.watch_parties wp
   SET rsvp_count = 0
 WHERE wp.rsvp_count > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.watch_party_rsvps r
      WHERE r.watch_party_id = wp.id AND r.status = 'going'
   );

NOTIFY pgrst, 'reload schema';
COMMENT ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT)
  IS 'v9.1 fix: delete-on-cancel (was silently 23514ing on status=none).';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════
-- 074_fix_watch_party_rsvps_recursion.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 074: Fix infinite recursion in watch_party_rsvps SELECT policy (v9.1 UAT)
--
-- WHY:
--   v9.1 UAT 2026-07-21 (Expo Go client log):
--     WARN [useMyRsvps] query error 42P17 infinite recursion detected in
--                        policy for relation "watch_party_rsvps"
--
--   The offending policy has been in prod since migration 007. Its third
--   USING branch reads FROM watch_party_rsvps inside a policy ON
--   watch_party_rsvps -- Postgres detects this at plan time and refuses to
--   run the query at all. Symptom stayed silent until v8.7 introduced
--   useMyRsvps(), which is the first client hook to issue a SELECT that
--   trips the recursive branch (previous callers all short-circuited on
--   user_id = auth.uid() or came via SECURITY DEFINER RPCs).
--
--   Same escape hatch that mig 051 used for chat_room_members: hoist the
--   self-referencing subquery into a SECURITY DEFINER helper. RLS does not
--   re-apply inside a SECURITY DEFINER function, so the inner query runs
--   as the function owner and the outer policy has no self-reference to
--   recurse into.
--
-- WHAT:
--   1. Create SECURITY DEFINER helper _user_is_party_attendee(party_id, user_id).
--   2. Drop + recreate watch_party_rsvps_select using the helper for the
--      "attendee sees fellow attendees" branch. First two branches
--      unchanged (own RSVPs + creator view).
--
-- No user-facing behaviour change vs the intent of mig 007 -- this
-- restores what mig 007 was supposed to allow, minus the crash.
--
-- Idempotent. Safe to replay.

BEGIN;

-- ─── 1. Recursion-breaking helper ──────────────────────────────────
-- STABLE + SECURITY DEFINER lets the planner cache the result within a
-- statement and skips RLS on the inner scan, so no self-reference.
CREATE OR REPLACE FUNCTION public._user_is_party_attendee(
  p_party_id UUID,
  p_user_id  UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.watch_party_rsvps
     WHERE watch_party_id = p_party_id
       AND user_id        = p_user_id
       AND status         = 'going'
  );
$$;

REVOKE EXECUTE ON FUNCTION public._user_is_party_attendee(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._user_is_party_attendee(UUID, UUID) TO authenticated;

-- ─── 2. Rewrite the SELECT policy ──────────────────────────────────
DROP POLICY IF EXISTS watch_party_rsvps_select ON public.watch_party_rsvps;
CREATE POLICY watch_party_rsvps_select ON public.watch_party_rsvps
  FOR SELECT TO authenticated
  USING (
    -- Own RSVPs (the useMyRsvps hot path -- also short-circuits the
    -- recursion detector even without the helper).
    user_id = auth.uid()
    -- Party creators see every RSVP on their party.
    OR watch_party_id IN (
      SELECT id FROM public.watch_parties WHERE creator_id = auth.uid()
    )
    -- Fellow attendees can see each other's RSVPs on the same party.
    -- Uses the SECURITY DEFINER helper so this branch does not
    -- self-reference watch_party_rsvps at plan time.
    OR public._user_is_party_attendee(watch_party_id, auth.uid())
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   -- Should return without 42P17 now:
--   SELECT id, watch_party_id, status FROM public.watch_party_rsvps
--    WHERE user_id = (SELECT id FROM auth.users WHERE email='mustattie@gmail.com')
--    LIMIT 5;
--
--   -- Helper is present + granted:
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname = '_user_is_party_attendee';
--   -- expect: prosecdef = t


-- ═══════════════════════════════════════════════════════════════════════
-- 075_wnba_and_cbb_leagues.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 075: WNBA sport + WNBA/CBB league seeds (v9.1.4)
--
-- WHY:
--   v9.1 UAT 2026-07-21: founder asked "I do not see WNBA and College
--   football, basketball why?" Discover's pill row was hardcoded to 5
--   sports (NFL/NBA/Soccer/MLB/NHL) despite constants/Sports.ts having
--   9. The frontend fix (v9.1.4 client) rewires Discover to derive pills
--   from the SPORTS constant AND adds WNBA to it. But WNBA still won't
--   surface any games or auto-suggest fan groups until:
--     1. A sports row exists for WNBA so chat_rooms.sport_id can point
--        at it and games rows can join to it.
--     2. A leagues row exists so sync-game-schedules can look it up
--        (leagueName ILIKE match) and start pulling ESPN payloads.
--
--   Same story for College Basketball: mig 007 seeded the sport row but
--   never created a leagues row, so the sync map entry v9.1.4 added would
--   fall through the join.
--
-- WHAT (idempotent, safe to replay):
--   1. Seed WNBA sport (a0000000-...-000000000009) if missing.
--   2. Seed WNBA league (b0000000-...-000000000009) pointing at the WNBA
--      sport row.
--   3. Seed College Basketball league (b0000000-...-00000000000a) pointing
--      at the existing CBB sport row from mig 007.
--
-- Team auto-upsert works via the teams_league_id_name_key UNIQUE constraint
-- mig 069 already added; sync-game-schedules INSERTs teams ON CONFLICT
-- (league_id, name) DO UPDATE the first time it sees them in an ESPN
-- payload. No hand-seeded team rows needed.

INSERT INTO public.sports (id, name, icon, color) VALUES
  ('a0000000-0000-0000-0000-000000000009', 'WNBA', '🏀', '#ff6b35')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000009',
   'a0000000-0000-0000-0000-000000000009',  -- WNBA sport
   'WNBA',
   'USA',
   '🏀'),
  ('b0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-000000000008',  -- College Basketball sport (mig 007)
   'College Basketball',
   'USA',
   '🏀')
ON CONFLICT (id) DO NOTHING;

-- Verify with:
--   SELECT id, name FROM public.sports WHERE name = 'WNBA';
--   SELECT id, name, sport_id FROM public.leagues
--    WHERE name IN ('WNBA', 'College Basketball')
--    ORDER BY name;


-- ═══════════════════════════════════════════════════════════════════════
-- 076_sweep_wc_groups_and_parties.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 076: Sweep leftover WC seed groups + watch parties (v9.1.5)
--
-- WHY:
--   v9.1 UAT 2026-07-22: founder saw stale WC content polluting Discover
--   even after v9.0/v9.1 sunset the WC product.
--     1. "United States Sup..." and 4 other WC groups on Suggested rail
--        despite the client filter (.neq group_type worldcup). Query 3
--        confirmed all 5 have group_type='worldcup' -- the client filter
--        should hide them but they still leak (cache / realtime path).
--     2. 23 of 24 watch_parties in the DB are past-dated (mig 006/047-era
--        WC seed data). Discover already hides these client-side with
--        .gt('starts_at', now()-2h), but they clutter admin views and one
--        surviving future-dated seed row ("France vs England Watch Party"
--        for Jul 25 2026) confused UAT because France vs England was
--        already played on 2026-07-18 in the seed's own match timeline.
--
--   WC is fully sunset per project_v9_pivot.md. Mig 060 already deleted
--   the fake game rows; this migration completes the sweep by removing
--   the group rows + watch party rows so the client-side filters become
--   defense-in-depth instead of the last line of defense.
--
--   Preserves: leagues + events + teams rows tied to WC 2026. Historic
--   FK integrity stays intact so anyone reading old rows still resolves
--   team names / event names cleanly.
--
-- WHAT (idempotent):
--   1. DELETE all chat_room_members whose chat_room is group_type='worldcup'.
--   2. DELETE all match_moments whose chat_room is group_type='worldcup'.
--   3. DELETE all messages whose chat_room is group_type='worldcup'.
--   4. DELETE the chat_rooms themselves.
--   5. DELETE all watch_party_rsvps for WC-event watch parties.
--   6. DELETE all watch_parties linked to the WC 2026 event.
--   7. (Preview only) SELECT surviving WC-title-pattern orphan parties
--      for manual review.

BEGIN;

-- ─── 1. chat_room_members for WC groups ────────────────────────────
DELETE FROM public.chat_room_members
 WHERE chat_room_id IN (
   SELECT id FROM public.chat_rooms WHERE group_type = 'worldcup'
 );

-- ─── 2. match_moments in WC group chat rooms ──────────────────────
DELETE FROM public.match_moments
 WHERE chat_room_id IN (
   SELECT id FROM public.chat_rooms WHERE group_type = 'worldcup'
 );

-- ─── 3. messages in WC group chat rooms ────────────────────────────
DELETE FROM public.messages
 WHERE chat_room_id IN (
   SELECT id FROM public.chat_rooms WHERE group_type = 'worldcup'
 );

-- ─── 4. the WC chat_rooms themselves ───────────────────────────────
DELETE FROM public.chat_rooms
 WHERE group_type = 'worldcup';

-- ─── 5. watch_party_rsvps for WC-event parties ─────────────────────
DELETE FROM public.watch_party_rsvps
 WHERE watch_party_id IN (
   SELECT id FROM public.watch_parties
    WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid
 );

-- ─── 6. WC-event watch parties ─────────────────────────────────────
DELETE FROM public.watch_parties
 WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid;

COMMIT;

-- ─── 7. Preview: orphan WC-titled parties (event_id IS NULL) ──────
-- These weren't linked to the WC event but have team-vs-team names
-- matching WC nations. Run manually AFTER the migration commits and
-- review; if you want them gone too, DELETE by id from the result set.
-- Left as a preview rather than an automated DELETE because "team vs
-- team" naming is legit for MLS / friendlies too and we don't want to
-- nuke user-created future parties.
--
-- SELECT id, title, starts_at, creator_id, created_at
--   FROM public.watch_parties
--  WHERE event_id IS NULL
--    AND title ~* '(france|england|argentina|brazil|germany|spain|portugal|italy|netherlands|belgium|croatia|morocco|senegal|japan|korea|mexico|usa|canada|united states|wales|iran|australia|denmark|switzerland|serbia|poland|uruguay|ecuador|ghana|cameroon|tunisia|qatar|saudi|ivory coast)\s+(vs?\.?\s+|-\s*|and\s+)'
--  ORDER BY starts_at DESC;

-- Verify with:
--   -- Should return 0
--   SELECT COUNT(*) AS wc_groups FROM public.chat_rooms WHERE group_type = 'worldcup';
--   -- Should return 0
--   SELECT COUNT(*) AS wc_event_parties FROM public.watch_parties
--    WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid;
--   -- Should return the same total as before minus WC-event parties
--   SELECT COUNT(*) AS total_parties FROM public.watch_parties;


-- ═══════════════════════════════════════════════════════════════════════
-- 077_fix_wnba_sport_uuid_collision.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 077: Fix WNBA sport UUID collision + backfill missing leagues (v9.1.7)
--
-- WHY:
--   v9.1 UAT 2026-07-22 diagnostic: Test #11 SQL probe revealed that the
--   sports row for UUID a0000000-0000-0000-0000-000000000009 is UFC, not
--   WNBA. UFC must have been seeded between mig 007 and mig 075 (via a
--   later migration or manual insert) and mig 075 didn't account for it.
--
--   Effect: mig 075's `INSERT INTO sports ... ON CONFLICT (id) DO NOTHING`
--   silently skipped WNBA sport insert. Then its `INSERT INTO leagues ...`
--   likely inserted the WNBA league row pointing at sport_id 000000009
--   (which is now UFC, not WNBA) -- so WNBA games would have been
--   classified as UFC.
--
--   Two-part fix in this migration:
--     1. Insert WNBA sport at a NEW unused UUID a0000000-...-00000000000a.
--     2. UPDATE any existing WNBA league row to point at that new WNBA
--        sport UUID (repairs mig 075's mis-linked row).
--     3. Belt-and-suspenders: INSERT the WNBA league row if it wasn't
--        created by mig 075 for any reason.
--     4. Also ensure College Football league exists (mig 069 required)
--        and College Basketball league exists (mig 075 required).
--
-- Idempotent -- safe to replay.

BEGIN;

-- ─── 1. WNBA sport at UUID 00000000000a (was 000000009, now taken by UFC) ─
INSERT INTO public.sports (id, name, icon, color) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'WNBA', '🏀', '#ff6b35')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Fix any existing WNBA league row that mig 075 mis-linked to UFC ──
UPDATE public.leagues
   SET sport_id = 'a0000000-0000-0000-0000-00000000000a'
 WHERE name = 'WNBA'
   AND sport_id = 'a0000000-0000-0000-0000-000000000009';  -- UFC

-- ─── 3. Ensure WNBA league row exists ────────────────────────────────
-- If mig 075's INSERT was skipped entirely for reasons unknown, this
-- creates it. If it already exists (whether at the pre-fix wrong
-- sport_id or the post-UPDATE correct one), ON CONFLICT is a no-op.
INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000009',
   'a0000000-0000-0000-0000-00000000000a',
   'WNBA', 'USA', '🏀')
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Ensure College Football league exists (mig 069 dep) ──────────
INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000008',
   'a0000000-0000-0000-0000-000000000007',
   'College Football', 'USA', '🏈')
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Ensure College Basketball league exists (mig 075 dep) ────────
INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-000000000008',
   'College Basketball', 'USA', '🏀')
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   SELECT id, name FROM public.sports WHERE name = 'WNBA';
--   -- expect: id = a0000000-0000-0000-0000-00000000000a
--
--   SELECT l.id, l.name, s.name AS sport
--     FROM public.leagues l
--     JOIN public.sports  s ON s.id = l.sport_id
--    WHERE l.name IN ('WNBA', 'College Football', 'College Basketball');
--   -- expect: 3 rows, all with sport matching league name


-- ═══════════════════════════════════════════════════════════════════════
-- 078_backfill_wnba_cfb_leagues.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 078: Backfill WNBA + College Football league rows at unused UUIDs (v9.1.8)
--
-- WHY:
--   v9.1 UAT 2026-07-22 continued diagnostic after mig 077. Full leagues
--   inventory shows both target UUIDs are pre-occupied:
--     UUID b0000000-...-000000000008 → "NCAA D1"  (sport_id = CBB)
--     UUID b0000000-...-000000000009 → "UFC"      (sport_id = UFC)
--     UUID b0000000-...-00000000000a → "College Basketball" (mig 075 landed here)
--   Neither mig 069 (CFB) nor mig 075 (WNBA) league insert ever landed
--   because their target UUIDs were already occupied by earlier seeds --
--   ON CONFLICT DO NOTHING silently swallowed both misses.
--
--   sync-game-schedules maps cfb → leagueName 'College Football' and
--   wnba → 'WNBA'. Without matching leagues rows, ESPN games synced for
--   those sports never resolve an event_id and get dropped from the join.
--   Explains Test #11 zero games for CFB / WNBA / CBB.
--
-- WHAT:
--   Insert WNBA + CFB league rows at fresh UUIDs 00b and 00c respectively
--   (confirmed free per the 11-row b0000000 namespace scan). Both point
--   at the correct sport_id (WNBA sport from mig 077, CFB sport from mig
--   007). Idempotent.
--
-- Deploy note: no changes to sync-game-schedules required -- it looks up
-- leagues by leagueName ILIKE match, not by UUID. As long as a row
-- exists with name='WNBA' or name='College Football', the sync stamps
-- event_id correctly regardless of which UUID the row uses.

BEGIN;

INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-00000000000b',
   'a0000000-0000-0000-0000-00000000000a',  -- WNBA sport (mig 077)
   'WNBA', 'USA', '🏀'),
  ('b0000000-0000-0000-0000-00000000000c',
   'a0000000-0000-0000-0000-000000000007',  -- College Football sport (mig 007)
   'College Football', 'USA', '🏈')
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   SELECT l.id, l.name AS league, s.name AS sport
--     FROM public.leagues l
--     JOIN public.sports  s ON s.id = l.sport_id
--    WHERE l.name IN ('WNBA', 'College Football', 'College Basketball')
--    ORDER BY l.name;
--   -- expect 3 rows, sport column matches league name for each


-- ═══════════════════════════════════════════════════════════════════════
-- 079_ensure_teams_league_name_unique.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 079: Ensure teams UNIQUE (league_id, name) constraint (v9.1.10)
--
-- WHY:
--   v9.1 UAT 2026-07-22 Test #11 diagnostic. sync-game-schedules edge
--   function returned per-sport breakdown:
--     mlb  → upserted=124, errors=[]
--     mls  → upserted=20,  errors=["team upsert: there is no unique or
--                                   exclusion constraint matching..."]
--     wnba → upserted=0,   errors=["team upsert: ..."],
--            unmatched_teams=["Los Angeles Sparks vs Phoenix Mercury (401857086)", ...]
--     nba/nfl/nhl/cbb/cfb/worldcup → upserted=0, errors=[] (all off-season)
--
--   The upsert uses .upsert(rows, { onConflict: "league_id,name" }) which
--   requires a UNIQUE constraint on (league_id, name) in the teams table.
--   Mig 069 was supposed to add teams_league_id_name_key with exactly that
--   shape, but either never applied to prod or applied with a different
--   name/definition. The 42P10 error message proves no matching constraint
--   is currently visible to PostgREST.
--
--   Effect: brand-new sports like WNBA (with zero pre-existing teams in the
--   DB) can never sync their first game because every team requires an
--   upsert, and every upsert fails. MLS got a partial pass because
--   pre-existing rows matched by global-name fallback and their games
--   inserted; new MLS teams from ESPN got skipped.
--
-- WHAT (idempotent):
--   Add the UNIQUE (league_id, name) constraint if it doesn't already
--   exist under any name. Check by predicate on the constraint's column
--   set rather than by name, since mig 069 might have applied under a
--   different name in some prior branch.

BEGIN;

DO $$
DECLARE
  has_constraint BOOLEAN;
BEGIN
  -- Does ANY unique constraint on teams cover exactly (league_id, name)?
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a1
        ON a1.attrelid = c.conrelid
       AND a1.attnum   = c.conkey[1]
      JOIN pg_attribute a2
        ON a2.attrelid = c.conrelid
       AND a2.attnum   = c.conkey[2]
     WHERE c.conrelid  = 'public.teams'::regclass
       AND c.contype   = 'u'
       AND array_length(c.conkey, 1) = 2
       AND (
             (a1.attname = 'league_id' AND a2.attname = 'name')
          OR (a1.attname = 'name'      AND a2.attname = 'league_id')
       )
  ) INTO has_constraint;

  IF NOT has_constraint THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_league_id_name_key UNIQUE (league_id, name);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.teams'::regclass
--      AND contype = 'u';
--   -- Expect a UNIQUE (league_id, name) row.
--
-- After this + re-invoke of the sync, expect WNBA breakdown to show
-- upserted > 0 (regular season is currently active) and unmatched_teams
-- to shrink to [].


-- ═══════════════════════════════════════════════════════════════════════
-- 080_clips_engagement_hotfix.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 080: Clips engagement pipeline hotfix (v9.2.0)
--
-- WHY:
--   Deep-dive audit 2026-07-22 revealed the entire clips engagement
--   pipeline is silently broken -- influencers currently see zeros for
--   Views, wrong numbers for Likes/Shares, and a "Following" feed
--   that isn't actually following anyone. Four of the five headline
--   metrics on Profile → My Stats are lies to the creator.
--
--   Root cause bundle:
--     * toggle_clip_like(p_clip_id) called with 1 arg from client, but
--       the current RPC signature is (p_clip_id, p_user_id) with an
--       auth-check that RAISEs on mismatch -- so every like is a
--       silent DB no-op that the client "catches" without noticing
--       (Postgrest errors resolve, don't reject).
--     * media_clips.view_count has never been incremented anywhere in
--       the entire codebase.
--     * media_clips.share_count column does not exist, but the mapper
--       reads it and creator-stats aggregates it. Share events land in
--       analytics_events with the wrong event_name filter, so the
--       stats query returns zero regardless.
--     * "Following" clips tab does `.order('created_at')` with no
--       user_follows join.
--
-- WHAT (idempotent):
--   1. Rewrite toggle_clip_like as 1-arg using auth.uid() internally,
--      matching how the client calls it. DELETE-on-toggle-off pattern
--      so denormalized like_count triggers stay honest.
--   2. Add media_clips.share_count INT column + trigger on
--      analytics_events INSERT to increment when event_name matches
--      the actual emitted value 'content_shared' and metadata.id points
--      at a media_clips row. Backfill from existing events.
--   3. Create clip_views table with UNIQUE (clip_id, viewer_id,
--      viewed_hour) so a single scroller can't inflate. Add
--      record_clip_view(p_clip_id) RPC that skips the creator's own
--      views and dedupes by hour.
--   4. Create get_following_clips(p_limit, p_offset) SECURITY DEFINER
--      RPC that joins user_follows.
--   5. One-shot reconciliation UPDATE for users.follower_count and
--      users.following_count in case any prior direct writes bypassed
--      the maintenance triggers.
--   6. Null out media_clips.sport_id values that don't match any known
--      sport key -- clips inserted before create-clip forced sport
--      selection had 'nfl' silently applied as a default even when the
--      creator meant something else. Nulling those makes the sport
--      badge honest ("no tag" instead of "wrong tag").

BEGIN;

-- ============================================================
-- 1. toggle_clip_like: 1-arg form matching how the client calls it.
-- ============================================================
DROP FUNCTION IF EXISTS public.toggle_clip_like(UUID, UUID);
DROP FUNCTION IF EXISTS public.toggle_clip_like(UUID);

CREATE OR REPLACE FUNCTION public.toggle_clip_like(p_clip_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_uid         UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing_id
    FROM public.clip_likes
   WHERE clip_id = p_clip_id AND user_id = v_uid;

  IF v_existing_id IS NOT NULL THEN
    -- Toggle off. Denormalized like_count decrement fires via
    -- trg_clip_like_delete (mig 004).
    DELETE FROM public.clip_likes WHERE id = v_existing_id;
    RETURN false;
  ELSE
    -- Toggle on. ON CONFLICT is defensive against a race with a
    -- concurrent client tap; the delete branch above already
    -- guaranteed no row exists at read time.
    INSERT INTO public.clip_likes (clip_id, user_id)
    VALUES (p_clip_id, v_uid)
    ON CONFLICT (clip_id, user_id) DO NOTHING;
    RETURN true;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.toggle_clip_like(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.toggle_clip_like(UUID) TO authenticated;

-- ============================================================
-- 2. Denormalized share_count + trigger + backfill.
-- ============================================================
ALTER TABLE public.media_clips
  ADD COLUMN IF NOT EXISTS share_count INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public._increment_clip_share_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clip_id UUID;
BEGIN
  -- Client emits 'content_shared' with metadata.id = clip_id for clip
  -- shares. Screen may be 'clips' or 'clip' depending on entry point;
  -- match on metadata.id existence as the primary signal so a future
  -- entry-point rename doesn't silently disable share counting again.
  IF NEW.event_name = 'content_shared'
     AND NEW.metadata IS NOT NULL
     AND NEW.metadata ? 'id' THEN
    BEGIN
      v_clip_id := (NEW.metadata->>'id')::uuid;
    EXCEPTION WHEN others THEN
      -- metadata.id isn't a UUID (e.g., a watch-party share). Skip.
      RETURN NEW;
    END;

    -- Only bump the count if the id actually points at a media_clip.
    -- Silently ignore shares of other content types.
    UPDATE public.media_clips
       SET share_count = share_count + 1
     WHERE id = v_clip_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_share_count ON public.analytics_events;
CREATE TRIGGER trg_analytics_share_count
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW EXECUTE FUNCTION public._increment_clip_share_count();

-- Backfill: sum existing content_shared events per clip id.
UPDATE public.media_clips mc
   SET share_count = COALESCE(sub.cnt, 0)
  FROM (
    SELECT (metadata->>'id')::uuid AS clip_id, COUNT(*) AS cnt
      FROM public.analytics_events
     WHERE event_name = 'content_shared'
       AND metadata ? 'id'
     GROUP BY (metadata->>'id')::uuid
  ) sub
 WHERE mc.id = sub.clip_id
   AND mc.share_count = 0;  -- don't double-count if backfill re-runs

-- ============================================================
-- 3. clip_views + record_clip_view RPC.
-- ============================================================
-- viewed_hour is a real column (not GENERATED). Postgres rejects
-- GENERATED expressions using date_trunc('hour', timestamptz) with
-- 42P17 because that function is STABLE (depends on session TZ), not
-- IMMUTABLE. The RPC populates viewed_hour on INSERT with an explicit
-- date_trunc call, which works fine because it runs per-statement.
CREATE TABLE IF NOT EXISTS public.clip_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id     UUID NOT NULL REFERENCES public.media_clips(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_hour TIMESTAMPTZ NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clip_views_dedup_key'
  ) THEN
    ALTER TABLE public.clip_views
      ADD CONSTRAINT clip_views_dedup_key
      UNIQUE (clip_id, viewer_id, viewed_hour);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clip_views_clip_id_idx ON public.clip_views (clip_id);

ALTER TABLE public.clip_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clip_views_insert_own ON public.clip_views;
CREATE POLICY clip_views_insert_own ON public.clip_views
  FOR INSERT TO authenticated
  WITH CHECK (viewer_id = auth.uid());

DROP POLICY IF EXISTS clip_views_select_own ON public.clip_views;
CREATE POLICY clip_views_select_own ON public.clip_views
  FOR SELECT TO authenticated
  USING (viewer_id = auth.uid());

CREATE OR REPLACE FUNCTION public.record_clip_view(p_clip_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_creator   UUID;
  v_inserted  BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Look up creator; skip creators viewing their own clips so a
  -- posting influencer previewing their own upload doesn't inflate.
  SELECT user_id INTO v_creator FROM public.media_clips WHERE id = p_clip_id;
  IF v_creator IS NULL OR v_creator = v_uid THEN RETURN; END IF;

  -- Dedupe by (clip_id, viewer_id, hour). One user watching the same
  -- clip 100 times in an hour counts as ONE view. viewed_hour is a
  -- regular column (not GENERATED -- see clip_views table comment) so
  -- we set it explicitly here with the same date_trunc expression.
  INSERT INTO public.clip_views (clip_id, viewer_id, viewed_hour)
       VALUES (p_clip_id, v_uid, date_trunc('hour', now()))
  ON CONFLICT ON CONSTRAINT clip_views_dedup_key DO NOTHING
  RETURNING true INTO v_inserted;

  IF v_inserted THEN
    UPDATE public.media_clips
       SET view_count = view_count + 1
     WHERE id = p_clip_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_clip_view(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_clip_view(UUID) TO authenticated;

-- ============================================================
-- 4. get_following_clips RPC (Following tab).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_following_clips(
  p_limit  INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS SETOF public.media_clips
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mc.*
    FROM public.media_clips mc
    JOIN public.user_follows uf
      ON uf.following_id = mc.user_id
   WHERE uf.follower_id = auth.uid()
   ORDER BY mc.created_at DESC
   LIMIT p_limit OFFSET p_offset;
$$;

REVOKE EXECUTE ON FUNCTION public.get_following_clips(INT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_following_clips(INT, INT) TO authenticated;

-- ============================================================
-- 5. Reconcile follower_count / following_count.
-- ============================================================
UPDATE public.users u
   SET follower_count  = COALESCE((
         SELECT COUNT(*) FROM public.user_follows
          WHERE following_id = u.auth_id
       ), 0),
       following_count = COALESCE((
         SELECT COUNT(*) FROM public.user_follows
          WHERE follower_id = u.auth_id
       ), 0);

-- ============================================================
-- 6. Null out orphan sport_id values on media_clips.
--    v9.2 forces explicit sport selection in Create Clip -- old rows
--    that got 'nfl' silently applied as the pre-fix default get
--    nulled here so the sport badge is honest going forward.
--    We only null values NOT present in the canonical Sports.ts list.
-- ============================================================
UPDATE public.media_clips
   SET sport_id = NULL
 WHERE sport_id IS NOT NULL
   AND sport_id NOT IN ('nfl','nba','wnba','mlb','soccer','nhl','cfb','cbb','mls','ufc');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   SELECT proname, oidvectortypes(proargtypes) FROM pg_proc
--    WHERE proname IN ('toggle_clip_like','record_clip_view','get_following_clips');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='media_clips' AND column_name='share_count';
--   SELECT COUNT(*) FROM public.clip_views;
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_analytics_share_count';


-- ═══════════════════════════════════════════════════════════════════════
-- 081_get_creator_stats_engagement_window.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 081: get_creator_stats aggregates engagement in a time window (v9.2.2)
--
-- WHY:
--   v9.2.0 UAT 2026-07-23: reviewer posted 3 clips ~34 days ago. Mustattie
--   liked all 3 today. Reviewer opened Profile → My Stats → "7 Days"
--   tab and saw all zeros -- even though 6 like events (Whoaa + Goooaaal
--   + Goal x2 each) landed within the last 7 days.
--
--   Root cause: creator-stats.tsx filters media_clips WHERE
--   created_at >= <cutoff>. That is "posts I made in the window," NOT
--   "engagement I received in the window." Consequence: a clip posted
--   40 days ago that gets 1000 likes today shows 0 likes on the 7-day
--   or 30-day view. Wrong semantic for an influencer dashboard --
--   creators track growth over time on their viral evergreen content,
--   not just posts from the last week.
--
-- WHAT (idempotent):
--   Create get_creator_stats(p_since timestamptz) SECURITY DEFINER RPC
--   that scopes counts to engagement timestamps (clip_views.viewed_at,
--   clip_likes.created_at, analytics_events.created_at with metadata.id
--   matching a media_clip owned by the caller).
--
--   Followers is a lifetime count from users.follower_count -- there is
--   no per-follow timestamp on user_follows.created_at that would let
--   us window follower growth; that's a follow-up ticket if we need it.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_creator_stats(
  p_since TIMESTAMPTZ
)
RETURNS TABLE (
  total_views  BIGINT,
  total_likes  BIGINT,
  total_shares BIGINT,
  followers    INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_followers INT;
BEGIN
  IF v_uid IS NULL THEN
    -- Unauthenticated caller. Return zeros rather than raising so the
    -- UI doesn't crash on a race between sign-in and the stats fetch.
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::int;
    RETURN;
  END IF;

  SELECT COALESCE(follower_count, 0)
    INTO v_followers
    FROM public.users
   WHERE auth_id = v_uid;

  RETURN QUERY
  WITH my_clips AS (
    SELECT id FROM public.media_clips WHERE user_id = v_uid
  )
  SELECT
    -- Views received in the window on the caller's own clips.
    COALESCE((
      SELECT COUNT(*)
        FROM public.clip_views cv
       WHERE cv.clip_id IN (SELECT id FROM my_clips)
         AND cv.viewed_at >= p_since
    ), 0)::bigint,

    -- Likes received in the window on the caller's own clips.
    COALESCE((
      SELECT COUNT(*)
        FROM public.clip_likes cl
       WHERE cl.clip_id IN (SELECT id FROM my_clips)
         AND cl.created_at >= p_since
    ), 0)::bigint,

    -- Shares OF the caller's clips in the window. analytics_events
    -- stores clip_id in metadata->>'id' for content_shared events.
    -- Regex-guard the value before casting to UUID -- a share event
    -- for a non-UUID target (unlikely but possible for future content
    -- types) is silently excluded rather than raising 22P02.
    COALESCE((
      SELECT COUNT(*)
        FROM public.analytics_events ae
       WHERE ae.event_name = 'content_shared'
         AND ae.metadata ? 'id'
         AND ae.created_at >= p_since
         AND (ae.metadata->>'id') ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND (ae.metadata->>'id')::uuid IN (SELECT id FROM my_clips)
    ), 0)::bigint,

    COALESCE(v_followers, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_creator_stats(TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_creator_stats(TIMESTAMPTZ) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   -- All-time (should equal lifetime totals)
--   SELECT * FROM public.get_creator_stats('1970-01-01'::timestamptz);
--   -- Last 7 days (should equal engagement received in the window,
--   -- regardless of when the underlying clip was posted)
--   SELECT * FROM public.get_creator_stats(now() - INTERVAL '7 days');


-- ═══════════════════════════════════════════════════════════════════════
-- 082_subscription_tiers.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 082: Freemium tiered subscription model (v9.3 launch).
--
-- WHY:
--   v9.3 introduces a tiered freemium model to replace the flat $9.99
--   Premium subscription. See docs/payment-system.md and the v9.3 plan
--   file (i-have-a-key-quiet-tome.md) for the full rationale. Tiers:
--     free       — join everything, watch everything, 3 clips/day cap,
--                  1 lifetime fan group (existing soft gate), 1 public
--                  watch party per month (deferred to a later mig).
--     home_team  — $4.99/mo · $34.99/yr. Unlimited creation, private
--                  parties, Home Team badge, ad-free, priority search.
--     mvp        — $14.99/mo · $99.99/yr. All Home Team + advanced
--                  analytics + verified badge + featured placement.
--     business   — $99/mo · $999/yr (Stripe, web-signup only, Phase 3).
--
--   Existing $9.99 subscribers are grandfathered to 'mvp' at their
--   current price forever. This is a goodwill upgrade (they get MORE
--   features, pay the same) — zero revenue lost, brand-positive.
--
-- WHAT this migration does:
--   1. Adds public.users.subscription_tier column (enum-shaped CHECK).
--   2. Adds public.entitlements.tier column tagging each ledger row.
--   3. Adds has_tier_or_higher(uid, min_tier) helper with reviewer bypass.
--   4. Rewrites has_premium_access() to be a shim over
--      has_tier_or_higher(uid, 'home_team') so every existing RLS policy
--      and client caller keeps working with zero code changes at those
--      call sites.
--   5. Adds get_user_tier(uid) reviewer-aware accessor for client reads.
--   6. Extends enforce_entitlement_immutability() trigger (mig 040) to
--      also protect subscription_tier from user-side writes.
--   7. Backfills existing active/trial subscribers to 'mvp' tier.
--
-- SAFETY:
--   * Additive column with DEFAULT 'free' → no existing row breaks.
--   * has_premium_access() signature unchanged; behavior expanded only.
--   * has_tier_or_higher() uses SECURITY DEFINER STABLE with explicit
--     search_path — matches the pattern from migrations 032/051/053.
--   * Reviewer bypass returns tier='mvp' (highest end-user tier) so
--     Apple/Google reviewers can exercise every free-tier AND paid-tier
--     surface. Their subscription_status stays 'none' so the IAP funnel
--     is visible when they navigate to Subscription.
--   * Immutability trigger update is additive — extends the existing
--     check to include the new column; doesn't relax any protections.

-- ─── 1. users.subscription_tier ────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'home_team', 'mvp', 'business'));

CREATE INDEX IF NOT EXISTS users_subscription_tier_idx
  ON public.users (subscription_tier);

COMMENT ON COLUMN public.users.subscription_tier IS
  'Freemium tier: free | home_team | mvp | business. Written ONLY by the RevenueCat webhook (service_role) or admin. Protected by enforce_entitlement_immutability trigger.';

-- ─── 2. entitlements.tier ──────────────────────────────────────────
-- Per-purchase tier tag so the ledger tells us which SKU family a row
-- represents. Nullable during initial rollout so the webhook can start
-- writing it without breaking existing rows that predate this column.
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS tier TEXT
    CHECK (tier IN ('home_team', 'mvp', 'business') OR tier IS NULL);

-- ─── 3. Grandfather existing subscribers → 'mvp' ───────────────────
-- Users with an active or trialing premium subscription get upgraded
-- to MVP at their current price forever. This is the grandfathering
-- covenant from the v9.3 plan.
--
-- Trigger from mig 040 blocks this from client code but the migration
-- runs as postgres role, so the trigger's `current_user IN (...)` branch
-- permits it. Verified against mig 040 line ~41.
UPDATE public.users
SET subscription_tier = 'mvp'
WHERE subscription_status IN ('trial', 'active')
  AND premium_active_until IS NOT NULL
  AND premium_active_until > now()
  AND subscription_tier = 'free';

-- Tag existing entitlements rows with tier='mvp' as well so the ledger
-- is coherent post-migration. Only touches Premium products; the WC
-- pass ledger rows stay tier=NULL (WC pass is a one-time purchase, not
-- a tier).
UPDATE public.entitlements
SET tier = 'mvp'
WHERE product_id LIKE 'premium_%'
  AND tier IS NULL;

-- ─── 4. Tier rank helper ───────────────────────────────────────────
-- Numeric rank for ordering tiers. free=0 < home_team=1 < mvp=2 <
-- business=3. Business is the top tier because it grants venue/admin
-- scopes AND includes all consumer features for the account owner.
CREATE OR REPLACE FUNCTION public.tier_rank(t TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE t
    WHEN 'free'      THEN 0
    WHEN 'home_team' THEN 1
    WHEN 'mvp'       THEN 2
    WHEN 'business'  THEN 3
    ELSE 0
  END;
$$;

-- ─── 5. has_tier_or_higher(uid, min_tier) ──────────────────────────
-- The workhorse predicate for tiered gates. Reviewer bypass returns
-- TRUE for any min_tier so reviewers exercise every paid feature.
-- SECURITY DEFINER so RLS policies can call it without granting the
-- caller's role SELECT on users.subscription_tier.
CREATE OR REPLACE FUNCTION public.has_tier_or_higher(uid UUID, min_tier TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_reviewer_account(uid)
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = uid
          AND public.tier_rank(u.subscription_tier) >= public.tier_rank(min_tier)
      );
$$;

GRANT EXECUTE ON FUNCTION public.has_tier_or_higher(UUID, TEXT) TO authenticated, anon;

COMMENT ON FUNCTION public.has_tier_or_higher(UUID, TEXT) IS
  'Returns TRUE if the user is at min_tier or above. Reviewer accounts always return TRUE. Use in RLS policies for tier-gated features. See migration 082.';

-- ─── 6. get_user_tier(uid) ─────────────────────────────────────────
-- Client-facing accessor. Reviewers see 'mvp' (top end-user tier).
-- Non-existent users default to 'free' — fail-open at the tier level
-- is safe because feature-level checks all use has_tier_or_higher
-- which is fail-closed.
CREATE OR REPLACE FUNCTION public.get_user_tier(uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_reviewer_account(uid) THEN 'mvp'
    ELSE COALESCE(
      (SELECT u.subscription_tier FROM public.users u WHERE u.auth_id = uid),
      'free'
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_tier(UUID) TO authenticated, anon;

-- ─── 7. has_premium_access shim ────────────────────────────────────
-- Every existing RLS policy that references has_premium_access() keeps
-- working. The definition changes from "trial-or-active with a valid
-- premium_active_until" to "tier is home_team or higher OR reviewer OR
-- legacy premium row still active". This preserves grandfathered
-- entitlements even for users whose subscription_tier didn't backfill
-- (e.g. a user who signed up between migration apply time and their
-- next webhook event).
CREATE OR REPLACE FUNCTION public.has_premium_access(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_tier_or_higher(uid, 'home_team')
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = uid
          AND u.subscription_status IN ('trial', 'active')
          AND u.premium_active_until IS NOT NULL
          AND u.premium_active_until > now()
      );
$$;

-- ─── 8. Immutability trigger — protect subscription_tier ───────────
-- Extends enforce_entitlement_immutability() (mig 040) to also reject
-- direct subscription_tier writes from non-service roles. Same escape
-- hatches: service_role JWT (webhook), postgres / supabase_admin
-- direct connection.
CREATE OR REPLACE FUNCTION public.enforce_entitlement_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF NEW.subscription_status     IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.premium_active_until IS NOT DISTINCT FROM OLD.premium_active_until
     AND NEW.wc_pass_active_until IS NOT DISTINCT FROM OLD.wc_pass_active_until
     AND NEW.subscription_tier    IS NOT DISTINCT FROM OLD.subscription_tier THEN
    RETURN NEW;
  END IF;

  v_role := current_setting('request.jwt.claims', true)::json->>'role';
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Entitlement columns (subscription_status, premium_active_until, '
    'wc_pass_active_until, subscription_tier) are read-only for '
    'non-service roles. The RevenueCat webhook is the source of truth.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Trigger definition itself is unchanged (still BEFORE UPDATE on users)
-- but re-declare to be idempotent-safe.
DROP TRIGGER IF EXISTS users_entitlement_immutable ON public.users;
CREATE TRIGGER users_entitlement_immutable
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_entitlement_immutability();

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Column present with 'free' default:
--   SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'subscription_tier';
--   -- expect: subscription_tier | 'free'::text
--
--   -- Grandfathering worked:
--   SELECT subscription_status, subscription_tier, count(*)
--   FROM public.users
--   GROUP BY 1,2 ORDER BY 1,2;
--   -- expect: rows where subscription_status IN ('trial','active') land
--   -- with subscription_tier='mvp'; everyone else stays 'free'.
--
--   -- Reviewer sees mvp:
--   SELECT public.get_user_tier(
--     (SELECT id FROM auth.users WHERE lower(email)='fansphere.reviewer@gmail.com')
--   );
--   -- expect: 'mvp'
--
--   -- Tier ordering:
--   SELECT public.has_tier_or_higher('<free-user-uid>'::uuid, 'home_team');
--   -- expect: false
--
--   -- has_premium_access shim still returns TRUE for grandfathered subs:
--   SELECT public.has_premium_access('<grandfathered-user-uid>'::uuid);
--   -- expect: true
--
--   -- Trigger rejects a direct client-side tier write (as authenticated):
--   SET LOCAL role authenticated;
--   UPDATE public.users SET subscription_tier='mvp' WHERE auth_id=auth.uid();
--   -- expect: ERROR: Entitlement columns ... are read-only (insufficient_privilege)


-- ═══════════════════════════════════════════════════════════════════════
-- 083_clip_quota.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 083: Daily clip-posting quota for free tier (v9.3 launch).
--
-- WHY:
--   The v9.3 freemium model gives every user 3 clips per rolling 24-hour
--   window before hitting the Home Team upgrade sheet. See migration 082
--   for the tier system this leans on. Home Team, MVP, and Business
--   tiers post unlimited.
--
--   Enforcement layer choice: RPC pre-check called from create-clip.tsx
--   before the upload is enqueued. This is client-facing gating, not a
--   security boundary — if a determined user bypasses it via a direct
--   .insert() they can post more than 3/day. For v9.3 we accept this
--   risk (no clients other than our own hit media_clips insert). If we
--   see abuse, v9.4 can add can_post_clip(uid) to the media_clips_insert
--   RLS as a hard gate.
--
--   Rolling-24h vs calendar-day: we picked rolling because it's more
--   user-friendly ("you can post again in 5h 12m") and doesn't require
--   knowing the user's timezone. Reset time returned is the oldest
--   still-counted clip's created_at + 24h.
--
-- WHAT this migration adds:
--   1. check_clip_quota(uid) RPC returning JSONB:
--        { allowed: bool, remaining: int, cap: int, resets_at: timestamptz | null, tier: text }
--      Home Team+ returns { allowed: true, remaining: 9999, cap: 9999 } (unlimited sentinel).
--
-- No RLS change — media_clips_insert stays open per mig 070.

-- ─── check_clip_quota ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_clip_quota(uid UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier      TEXT;
  v_cap       INT := 3;
  v_used      INT;
  v_oldest    TIMESTAMPTZ;
  v_resets_at TIMESTAMPTZ;
  v_public_users_id UUID;
BEGIN
  v_tier := public.get_user_tier(uid);

  -- Home Team+ (or reviewer) posts unlimited.
  IF public.tier_rank(v_tier) >= public.tier_rank('home_team') THEN
    RETURN jsonb_build_object(
      'allowed',   true,
      'remaining', 9999,
      'cap',       9999,
      'resets_at', NULL,
      'tier',      v_tier
    );
  END IF;

  -- media_clips.user_id references public.users.id (NOT auth.users.id).
  -- The client passes auth.users.id; resolve it here so callers don't
  -- have to.
  SELECT id INTO v_public_users_id
  FROM public.users
  WHERE auth_id = uid;

  IF v_public_users_id IS NULL THEN
    -- User row hasn't been created yet (fresh signup). No clips
    -- posted → full quota available.
    RETURN jsonb_build_object(
      'allowed',   true,
      'remaining', v_cap,
      'cap',       v_cap,
      'resets_at', NULL,
      'tier',      v_tier
    );
  END IF;

  -- Count clips posted in the rolling 24h window and get the oldest
  -- one so we can compute the reset time.
  SELECT count(*), min(created_at)
  INTO v_used, v_oldest
  FROM public.media_clips
  WHERE user_id = v_public_users_id
    AND created_at > now() - interval '24 hours';

  IF v_oldest IS NOT NULL THEN
    v_resets_at := v_oldest + interval '24 hours';
  END IF;

  RETURN jsonb_build_object(
    'allowed',   v_used < v_cap,
    'remaining', GREATEST(v_cap - v_used, 0),
    'cap',       v_cap,
    'resets_at', v_resets_at,
    'tier',      v_tier
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_clip_quota(UUID) TO authenticated;

COMMENT ON FUNCTION public.check_clip_quota(UUID) IS
  'Returns clip-posting quota for the user. Free tier: 3 clips per rolling 24h. Home Team+: unlimited (9999 sentinel). See migration 083.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Fresh free user (no clips posted) → allowed with full quota:
--   SELECT public.check_clip_quota('<free-user-auth-uid>'::uuid);
--   -- expect: {"allowed": true, "remaining": 3, "cap": 3, "resets_at": null, "tier": "free"}
--
--   -- Free user who posted 3 clips in last 24h → blocked:
--   SELECT public.check_clip_quota('<capped-user-auth-uid>'::uuid);
--   -- expect: {"allowed": false, "remaining": 0, "cap": 3, "resets_at": "2026-08-07T...", "tier": "free"}
--
--   -- Home Team subscriber → unlimited:
--   SELECT public.check_clip_quota('<home-team-uid>'::uuid);
--   -- expect: {"allowed": true, "remaining": 9999, "cap": 9999, "resets_at": null, "tier": "home_team"}
--
--   -- Reviewer → unlimited (even with subscription_tier='free'):
--   SELECT public.check_clip_quota(
--     (SELECT id FROM auth.users WHERE lower(email)='fansphere.reviewer@gmail.com')
--   );
--   -- expect: {"allowed": true, "remaining": 9999, "cap": 9999, "resets_at": null, "tier": "mvp"}


-- ═══════════════════════════════════════════════════════════════════════
-- 084_watch_party_attendees_and_affinity.sql
-- ═══════════════════════════════════════════════════════════════════════
-- 084: Host-aware attendees + fan-group affinity for watch parties.
--
-- v9.4.0 UAT Round 3.
--
-- WHY:
--   Two related surfaces on Watch Party detail need better data:
--
--   #9  The host currently sees the same attendees list guests do -- a flat
--       list of RSVPs. UAT wants the host to see per-status breakdown
--       (Going / Maybe / Can't Go) so they can plan headcount, chase
--       maybes, etc. Guests should see totals only for privacy -- no one
--       wants their soft decline made public.
--
--   #6  Every attendee row currently reads as an isolated identity. UAT
--       wants a fan-group affinity callout: "10 fans from Frisco Mavericks
--       Fan Club also going." Signals the network effect and gives fans
--       a reason to join the party. Same signal used on Home + Discover
--       "Watch Parties Nearby" cards.
--
-- WHAT this adds:
--   1. get_watch_party_attendees_v2(p_party_id, p_viewer_id) -- role-aware
--      accessor. For hosts, returns ALL rsvp rows for the party regardless
--      of status. For non-hosts, returns only status='going' rows. Also
--      returns a totals column so the client can render the summary
--      without a second round-trip.
--   2. get_watch_party_group_affinity(p_party_id, p_viewer_id) -- returns
--      one row per fan group where at least one member has RSVP'd going,
--      with the count and group name. Filtered to fan groups the viewer
--      is a member of, so the callout is personal.
--
-- SAFETY:
--   * Both functions are SECURITY DEFINER with explicit search_path -- matches
--     the pattern from migrations 017/032/051/053/082.
--   * Role detection reads watch_parties.creator_id vs auth.uid() so the
--     caller cannot spoof host access. Reviewer bypass NOT applied here --
--     stats vs playbook privacy differ, and reviewers aren't real hosts.
--   * Guest branch preserves existing `going + interested` semantics from
--     mig 017 -- v9.4 renames "Interested" -> "Maybe" client-side but the
--     status enum stays as-is until a full rename migration lands.
--   * Affinity RPC uses chat_room_members (v9.x fan-group unit) joined
--     against watch_party_rsvps. If a user is in many groups AND many of
--     those group members RSVP'd, we return one row per (group_id, party_id).

-- ─── 1. get_watch_party_attendees_v2 ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_watch_party_attendees_v2(
  p_party_id UUID,
  p_viewer_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  status TEXT,
  display_name TEXT,
  is_host BOOLEAN,
  total_going INT,
  total_maybe INT,
  total_cant_go INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator UUID;
  v_is_host BOOLEAN;
BEGIN
  SELECT wp.creator_id INTO v_creator
  FROM public.watch_parties wp
  WHERE wp.id = p_party_id;

  v_is_host := (v_creator IS NOT NULL AND v_creator = p_viewer_id);

  RETURN QUERY
  WITH totals AS (
    SELECT
      count(*) FILTER (WHERE r.status = 'going')       AS going,
      count(*) FILTER (WHERE r.status = 'interested')  AS maybe,
      count(*) FILTER (WHERE r.status = 'cant_go')     AS cant_go
    FROM public.watch_party_rsvps r
    WHERE r.watch_party_id = p_party_id
  )
  SELECT
    r.id,
    r.user_id,
    r.status,
    COALESCE(u.display_name, 'User') AS display_name,
    v_is_host AS is_host,
    t.going::INT      AS total_going,
    t.maybe::INT      AS total_maybe,
    t.cant_go::INT    AS total_cant_go
  FROM public.watch_party_rsvps r
  LEFT JOIN public.users u ON u.auth_id = r.user_id
  CROSS JOIN totals t
  WHERE r.watch_party_id = p_party_id
    AND (
      v_is_host
      OR r.status = 'going'
    )
  ORDER BY
    CASE r.status WHEN 'going' THEN 0 WHEN 'interested' THEN 1 ELSE 2 END,
    r.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID) IS
  'Host-aware attendees: hosts see all statuses, guests see going only. Totals returned per-row for cheap client rendering. See migration 084.';

-- ─── 2. get_watch_party_group_affinity ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_watch_party_group_affinity(
  p_party_id UUID,
  p_viewer_id UUID
)
RETURNS TABLE (
  group_id UUID,
  group_name TEXT,
  going_count INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- For each fan group the viewer is a member of, count how many other
  -- members RSVP'd going to this party. Filtered to > 0 so empty groups
  -- don't clutter the callout. Excludes worldcup group_type rows since
  -- the v9.x pivot hides those from the UI.
  WITH viewer_groups AS (
    SELECT cr.id AS group_id, cr.name AS group_name
    FROM public.chat_room_members m
    JOIN public.chat_rooms cr ON cr.id = m.chat_room_id
    WHERE m.user_id = p_viewer_id
      AND cr.group_type IS DISTINCT FROM 'worldcup'
  )
  SELECT
    vg.group_id,
    vg.group_name,
    count(*)::INT AS going_count
  FROM viewer_groups vg
  JOIN public.chat_room_members gm ON gm.chat_room_id = vg.group_id
  JOIN public.watch_party_rsvps r  ON r.user_id = gm.user_id
  WHERE r.watch_party_id = p_party_id
    AND r.status = 'going'
    AND gm.user_id <> p_viewer_id      -- exclude the viewer themselves
  GROUP BY vg.group_id, vg.group_name
  HAVING count(*) > 0
  ORDER BY count(*) DESC
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_watch_party_group_affinity(UUID, UUID)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_watch_party_group_affinity(UUID, UUID) IS
  'Returns top 5 fan groups the viewer is in whose members have RSVP''d going to this party. Powers the "N fans from [Group] also going" callouts on Home + Discover + Watch Party detail. See migration 084.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Host sees all statuses:
--   SELECT status, count(*) FROM get_watch_party_attendees_v2(
--     '<party-id>',
--     (SELECT creator_id FROM watch_parties WHERE id = '<party-id>')
--   ) GROUP BY 1;
--
--   -- Guest sees going only:
--   SELECT DISTINCT status FROM get_watch_party_attendees_v2(
--     '<party-id>', '<random-guest-auth-uid>'
--   );
--   -- expect: 'going' (single row)
--
--   -- Totals populated for both (identical values):
--   SELECT DISTINCT total_going, total_maybe, total_cant_go
--   FROM get_watch_party_attendees_v2('<party-id>', '<any-uid>');
--
--   -- Affinity returns groups the viewer is in with going-count > 0:
--   SELECT * FROM get_watch_party_group_affinity('<party-id>', '<viewer-uid>');


-- ═══════════════════════════════════════════════════════════════════════
-- Post-apply verification — run these separately after applying above
-- ═══════════════════════════════════════════════════════════════════════
-- 1) All three UAT round 4 RPCs should be present:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('get_or_create_game_chat','cast_mvp_vote','rsvp_to_watch_party','get_watch_party_attendees_v2','get_watch_party_group_affinity')
--    ORDER BY 1, 2;
-- 2) WNBA sport row exists (should return 1):
--   SELECT count(*) FROM public.sports WHERE lower(name) = 'wnba';
-- 3) Force PostgREST schema-cache reload if the app still shows
--    "not found in schema cache" after the run:
--   NOTIFY pgrst, 'reload schema';
