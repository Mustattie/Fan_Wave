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
