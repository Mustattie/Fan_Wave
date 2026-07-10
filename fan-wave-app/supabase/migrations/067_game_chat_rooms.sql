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
