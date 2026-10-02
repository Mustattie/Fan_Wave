-- 103: rate-limit ceilings enforced on the server (P2.7) — tier-aware rewrite
--
-- STATUS: PREPARED, NOT APPLIED. Needs owner approval; apply via the
-- Management API query endpoint (never `db push` on prod). Additive and
-- idempotent; the executable reversal is at the bottom. Local proof:
--   node scripts/test-migration-103.mjs
-- (scratch Postgres, applies 099 + 102 + this file + supabase/tests/103).
--
-- Why a rewrite (readiness review of v9.5.28, recorded in the Stability
-- Program Report and the v9.5.36 commit body). The first draft:
--   1. capped media_clips_insert at 5/hour for EVERY tier, contradicting
--      the "unlimited clips" Home Team promise that 083/095/102 enforce;
--   2. rejected operator inserts: a session with no JWT (SQL editor,
--      Management API, pg_cron, psql) has role '' which was NOT exempt,
--      so backfills and repairs drew from — and were refused by — a
--      per-user budget;
--   3. used BEFORE INSERT triggers, which fire even when ON CONFLICT turns
--      the insert into an update or a no-op, so an RSVP status change,
--      a repeated like or a repeated follow burned budget;
--   4. had no trigger on match_moments although moment_post has a
--      ceiling (the client pre-check) and no server cap;
--   5. duplicated every ceiling from check_rate_limit (099) — two
--      sources of truth that could drift;
--   6. never garbage-collected rate_limits from the trigger path;
--   7. left rate_limit_ceiling executable by PUBLIC.
--
-- Design now:
--   * One table of ceilings: rate_limit_ceiling(action, tier). The client
--     pre-check (check_rate_limit, same signature as 099, redefined here)
--     and the server triggers both read it. Free-tier numbers are the
--     ones 099 already enforces; Home Team and above get abuse ceilings
--     well above anything a person does by hand, so the paid promise
--     ("unlimited creation") is preserved while a scripted client is
--     still bounded. Reviewer accounts resolve to 'mvp' via
--     get_user_tier, exactly as the clip quota does.
--   * Enforcement is a row-level AFTER INSERT trigger. PostgreSQL fires
--     AFTER INSERT only for rows that were actually inserted, so
--     INSERT ... ON CONFLICT DO UPDATE / DO NOTHING (rsvp_to_watch_party,
--     toggle_clip_like, follow_user) and any UPDATE path cost nothing.
--     Rows refused earlier by another trigger or a constraint (e.g. the
--     102 clip quota) cost nothing either. A refusal raises and rolls
--     the statement back, exactly as a BEFORE trigger would.
--   * Only end-user requests are limited: JWT role 'authenticated' or
--     'anon'. service_role and sessions with no JWT at all (operator
--     tooling, cron, migrations, seeds) are exempt.
--   * Identity is auth.uid() when a JWT is present (the same rule 099
--     applies), falling back to the row's user column only for callers
--     without one. The bucket key is '<table>_insert', separate from the
--     client's advisory keys, so a pre-checked write is not double-counted.
--   * Refusals raise SQLSTATE 'PT429', which PostgREST maps to HTTP 429
--     (supabase-js error.code = 'PT429'). 42501 is deliberately NOT used:
--     the RSVP screen treats every 42501 from rsvp_to_watch_party as an
--     entitlement failure and shows an upgrade prompt. The message says
--     "rate limit" and "too many", which the k6 taxonomy
--     (tests/load/lib/http.js) already recognises.
--   * rate_limits rows older than one day (the longest window) are
--     removed by the gc-rate-limits cron (052, retention set by 099) and,
--     as a backstop, by a bounded probabilistic sweep on ~1 % of consumes.
--   * The pre-check keeps 099's "a caller may tighten, never loosen"
--     rule, so this file is the authority on every ceiling. The clients
--     for the tiered actions (create-clip.tsx, MomentsFeed.tsx,
--     watch-party/[id].tsx) now pass NULL for p_max_count and
--     p_window_seconds and receive their tier's ceiling; chat keeps its
--     explicit 60/60 because that ceiling does not vary by tier. Builds in
--     the field that still send 5/3600 are honoured as a tightening,
--     exactly as under 099, until they update.
--   * Counting is serialised per (user, action) with a transaction-scoped
--     advisory lock in both rate_limit_consume and check_rate_limit, so
--     concurrent requests cannot all read the same count and overshoot.
--     The lock is released at commit, when the new ledger row is visible.
--
-- Ceilings (count / window seconds), free -> home_team and above:
--   message_send, messages_insert           60 / 60      ->  60 / 60
--   clip_post,    media_clips_insert         5 / 3600    ->  30 / 3600
--   moment_post,  match_moments_insert      10 / 3600    ->  60 / 3600
--   rsvp,         watch_party_rsvps_insert  20 / 86400   -> 100 / 86400
--   watch_parties_insert                    10 / 86400   ->  50 / 86400
--   clip_comments_insert                    30 / 60      ->  30 / 60
--   clip_likes_insert                      120 / 60      -> 120 / 60
--   user_follows_insert                     60 / 60      ->  60 / 60
--   anything else                           60 / 60      ->  60 / 60
-- The free-tier clip figure is moot in practice (102 stops a free account
-- at 3 per 24 h first) but stays as the burst cap the pre-check shows.
--
-- Depends on: public.rate_limits (018/037), public.tier_rank and
-- public.get_user_tier (082), auth.uid(). 102 is independent of this file
-- and may be applied before or after it.

-- ─── 0. Retire the first draft's shapes if they were ever applied ─────
-- (never applied to prod; harmless elsewhere)
DROP FUNCTION IF EXISTS public.rate_limit_ceiling(TEXT);

-- ─── 1. Single source of truth for every ceiling ───────────────────────
CREATE OR REPLACE FUNCTION public.rate_limit_ceiling(
  p_action TEXT,
  p_tier   TEXT,
  OUT max_count      INT,
  OUT window_seconds INT
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_action IN ('message_send', 'messages_insert')       THEN 60
      WHEN p_action IN ('clip_post', 'media_clips_insert')       THEN CASE WHEN s.paid THEN 30  ELSE 5  END
      WHEN p_action IN ('moment_post', 'match_moments_insert')   THEN CASE WHEN s.paid THEN 60  ELSE 10 END
      WHEN p_action IN ('rsvp', 'watch_party_rsvps_insert')      THEN CASE WHEN s.paid THEN 100 ELSE 20 END
      WHEN p_action = 'watch_parties_insert'                     THEN CASE WHEN s.paid THEN 50  ELSE 10 END
      WHEN p_action = 'clip_comments_insert'                     THEN 30
      WHEN p_action = 'clip_likes_insert'                        THEN 120
      WHEN p_action = 'user_follows_insert'                      THEN 60
      ELSE 60
    END,
    CASE
      WHEN p_action IN ('clip_post', 'media_clips_insert',
                        'moment_post', 'match_moments_insert')   THEN 3600
      WHEN p_action IN ('rsvp', 'watch_party_rsvps_insert',
                        'watch_parties_insert')                  THEN 86400
      ELSE 60
    END
  FROM (
    SELECT public.tier_rank(COALESCE(p_tier, 'free')) >= public.tier_rank('home_team') AS paid
  ) s;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_ceiling(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.rate_limit_ceiling(TEXT, TEXT) IS
  'The only place a rate-limit ceiling is defined. Read by check_rate_limit (client pre-check) and enforce_insert_rate_limit (server trigger). Tier is a public.users.subscription_tier value; home_team and above get the paid ceilings. See migration 103.';

-- ─── 2. Who is asking: the JWT role, or NULL for no JWT at all ─────────
-- NULLIF guards: an unset or emptied setting must read as "no JWT", not
-- as a JSON parse error inside a trigger.
CREATE OR REPLACE FUNCTION public.rate_limit_request_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_request_role() FROM PUBLIC, anon, authenticated;

-- ─── 3. Bounded garbage collection of the ledger ───────────────────────
-- Retention is one day: the longest window in rate_limit_ceiling. The
-- gc-rate-limits cron (052, retention widened by 099) is the primary
-- sweeper; this is the in-band backstop and the tool for a manual sweep.
CREATE OR REPLACE FUNCTION public.rate_limit_gc(p_limit INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH victims AS (
    SELECT ctid
    FROM public.rate_limits
    WHERE window_start < now() - interval '1 day'
    LIMIT GREATEST(COALESCE(p_limit, 500), 1)
  )
  DELETE FROM public.rate_limits r
  USING victims v
  WHERE r.ctid = v.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_gc(INT) FROM PUBLIC, anon, authenticated;

-- ─── 4. Count-and-record for one user; TRUE when allowed ───────────────
-- Internal: no GRANT; called only from the trigger below.
CREATE OR REPLACE FUNCTION public.rate_limit_consume(
  p_user_id UUID,
  p_action  TEXT,
  p_tier    TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max    INT;
  v_window INT;
  v_count  INT;
BEGIN
  SELECT c.max_count, c.window_seconds
    INTO v_max, v_window
    FROM public.rate_limit_ceiling(p_action, p_tier) c;

  -- Serialise this user's bucket for the rest of the transaction, so two
  -- in-flight requests cannot both read "59 used" and both pass. The lock
  -- is held until commit, which is exactly when the row below becomes
  -- visible to the next waiter. Same key shape as check_rate_limit.
  PERFORM pg_advisory_xact_lock(hashtextextended('rate_limit:' || p_action || ':' || p_user_id::text, 0));

  SELECT COALESCE(SUM(count), 0)
    INTO v_count
    FROM public.rate_limits
   WHERE user_id = p_user_id
     AND action  = p_action
     AND window_start >= now() - make_interval(secs => v_window);

  IF v_count >= v_max THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.rate_limits (user_id, action) VALUES (p_user_id, p_action);

  -- Backstop GC on ~1 % of consumes, bounded so no request pays for a
  -- large sweep.
  IF random() < 0.01 THEN
    PERFORM public.rate_limit_gc(500);
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_consume(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- The first draft's two-argument overload, if it exists anywhere.
DROP FUNCTION IF EXISTS public.rate_limit_consume(UUID, TEXT);

-- ─── 5. The trigger body ───────────────────────────────────────────────
-- AFTER INSERT, row level. TG_ARGV[0] names the row's user column (the
-- tables disagree: user_id / follower_id / creator_id). The action key is
-- '<table>_insert'.
CREATE OR REPLACE FUNCTION public.enforce_insert_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   TEXT;
  v_user   UUID;
  v_tier   TEXT;
  v_action TEXT := TG_TABLE_NAME || '_insert';
  v_noun   TEXT;
  v_max    INT;
  v_window INT;
BEGIN
  -- Only end-user requests are limited. service_role, and sessions with
  -- no JWT (SQL editor, Management API, pg_cron, psql, migrations), pass.
  v_role := public.rate_limit_request_role();
  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;

  -- Identity: the JWT subject (099's rule). The row column is only a
  -- fallback for a request that somehow carries a role but no subject.
  v_user := auth.uid();
  IF v_user IS NULL AND TG_NARGS > 0 THEN
    v_user := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  END IF;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  v_tier := public.get_user_tier(v_user);

  IF NOT public.rate_limit_consume(v_user, v_action, v_tier) THEN
    SELECT c.max_count, c.window_seconds
      INTO v_max, v_window
      FROM public.rate_limit_ceiling(v_action, v_tier) c;
    v_noun := CASE TG_TABLE_NAME
      WHEN 'messages'          THEN 'messages'
      WHEN 'media_clips'       THEN 'clips'
      WHEN 'clip_comments'     THEN 'comments'
      WHEN 'clip_likes'        THEN 'likes'
      WHEN 'user_follows'      THEN 'follows'
      WHEN 'watch_party_rsvps' THEN 'RSVPs'
      WHEN 'watch_parties'     THEN 'watch parties'
      WHEN 'match_moments'     THEN 'moments'
      ELSE 'actions'
    END;
    -- PT429 -> PostgREST HTTP 429. Not 42501: the RSVP screen reads 42501
    -- as "needs an upgrade".
    RAISE EXCEPTION 'Rate limit: too many % in a short time. Please wait a moment and try again.', v_noun
      USING ERRCODE = 'PT429',
            DETAIL  = format('limit %s per %s seconds', v_max, v_window),
            HINT    = 'rate_limited:' || v_action;
  END IF;

  RETURN NULL;  -- ignored for AFTER triggers
END;
$$;

COMMENT ON FUNCTION public.enforce_insert_rate_limit() IS
  'AFTER INSERT rate-limit ceiling, keyed <table>_insert and tier-aware via rate_limit_ceiling. End-user JWT roles only; service_role and no-JWT sessions are exempt. Raises PT429 (HTTP 429). See migration 103.';

-- ─── 6. Triggers (AFTER INSERT, so upserts that update or no-op are free)
-- Same trigger names as the first draft, so DROP IF EXISTS replaces a
-- BEFORE trigger of that name wherever one was applied.
DROP TRIGGER IF EXISTS trg_rate_limit_messages ON public.messages;
CREATE TRIGGER trg_rate_limit_messages
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_media_clips ON public.media_clips;
CREATE TRIGGER trg_rate_limit_media_clips
  AFTER INSERT ON public.media_clips
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_clip_comments ON public.clip_comments;
CREATE TRIGGER trg_rate_limit_clip_comments
  AFTER INSERT ON public.clip_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_clip_likes ON public.clip_likes;
CREATE TRIGGER trg_rate_limit_clip_likes
  AFTER INSERT ON public.clip_likes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_user_follows ON public.user_follows;
CREATE TRIGGER trg_rate_limit_user_follows
  AFTER INSERT ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('follower_id');

DROP TRIGGER IF EXISTS trg_rate_limit_watch_party_rsvps ON public.watch_party_rsvps;
CREATE TRIGGER trg_rate_limit_watch_party_rsvps
  AFTER INSERT ON public.watch_party_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_watch_parties ON public.watch_parties;
CREATE TRIGGER trg_rate_limit_watch_parties
  AFTER INSERT ON public.watch_parties
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('creator_id');

DROP TRIGGER IF EXISTS trg_rate_limit_match_moments ON public.match_moments;
CREATE TRIGGER trg_rate_limit_match_moments
  AFTER INSERT ON public.match_moments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

-- ─── 7. The client pre-check reads the same ceilings ───────────────────
-- Same signature and semantics as 099 (identity = auth.uid(); p_user_id
-- ignored; a caller may tighten but never loosen; anon denied). The CASE
-- table that lived here is gone — rate_limit_ceiling is the source.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_user_id        UUID,
    p_action         TEXT,
    p_max_count      INT DEFAULT 60,
    p_window_seconds INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid          UUID;
    v_max          INT;
    v_window       INT;
    v_window_start TIMESTAMPTZ;
    v_count        INT;
BEGIN
    -- The caller's argument is deliberately unused. Identity is the JWT's.
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT c.max_count, c.window_seconds
      INTO v_max, v_window
      FROM public.rate_limit_ceiling(p_action, public.get_user_tier(v_uid)) c;

    -- A client may tighten (fewer actions, longer window) but never loosen.
    v_max    := LEAST(COALESCE(p_max_count, v_max), v_max);
    v_window := GREATEST(COALESCE(p_window_seconds, v_window), v_window);

    v_window_start := now() - make_interval(secs => v_window);

    -- Same per-user, per-action serialisation as rate_limit_consume.
    PERFORM pg_advisory_xact_lock(hashtextextended('rate_limit:' || p_action || ':' || v_uid::text, 0));

    SELECT COALESCE(SUM(count), 0) INTO v_count
    FROM public.rate_limits
    WHERE user_id = v_uid
      AND action = p_action
      AND window_start >= v_window_start;

    IF v_count >= v_max THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.rate_limits (user_id, action)
    VALUES (v_uid, p_action);

    IF random() < 0.01 THEN
        PERFORM public.rate_limit_gc(500);
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT) TO authenticated;

COMMENT ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT) IS
  'Per-user advisory pre-check. Identity is auth.uid(); p_user_id is ignored (mig 099). Ceilings come from rate_limit_ceiling and are tier-aware (mig 103); callers may only tighten them. The server ceiling is enforce_insert_rate_limit.';

NOTIFY pgrst, 'reload schema';

-- ─── PRE-CHECK before applying ─────────────────────────────────────────
--   -- the user columns the triggers read exist:
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name IN ('messages','media_clips','clip_comments','clip_likes',
--                        'user_follows','watch_party_rsvps','watch_parties','match_moments')
--     AND column_name IN ('user_id','follower_id','creator_id');
--   -- expect 8 rows.
--   -- the helpers this file calls exist:
--   SELECT proname FROM pg_proc WHERE proname IN ('get_user_tier','tier_rank') AND pronamespace = 'public'::regnamespace;
--   -- expect 2 rows.
--
-- ─── Verification (SQL editor, after applying) ─────────────────────────
--   SELECT tgrelid::regclass, tgname, (tgtype & 2) = 0 AS is_after
--   FROM pg_trigger WHERE tgname LIKE 'trg_rate_limit_%' ORDER BY 1;
--   -- expect 8 rows, all is_after = true
--   SELECT * FROM public.rate_limit_ceiling('clip_post', 'free');       -- 5, 3600
--   SELECT * FROM public.rate_limit_ceiling('clip_post', 'home_team');  -- 30, 3600
--   SELECT has_function_privilege('authenticated', 'public.rate_limit_ceiling(text,text)', 'execute'); -- false
--   -- operator inserts are exempt: run any INSERT here (no JWT) and
--   -- confirm no row appears in public.rate_limits for it.
--
-- ─── Reversal (executable; the test runner replays it) ─────────────────
-- Order matters: check_rate_limit depends on rate_limit_ceiling, so the
-- 099 body is restored before the ceiling function is dropped.
-- REVERSAL-A-BEGIN
-- DROP TRIGGER IF EXISTS trg_rate_limit_messages          ON public.messages;
-- DROP TRIGGER IF EXISTS trg_rate_limit_media_clips       ON public.media_clips;
-- DROP TRIGGER IF EXISTS trg_rate_limit_clip_comments     ON public.clip_comments;
-- DROP TRIGGER IF EXISTS trg_rate_limit_clip_likes        ON public.clip_likes;
-- DROP TRIGGER IF EXISTS trg_rate_limit_user_follows      ON public.user_follows;
-- DROP TRIGGER IF EXISTS trg_rate_limit_watch_party_rsvps ON public.watch_party_rsvps;
-- DROP TRIGGER IF EXISTS trg_rate_limit_watch_parties     ON public.watch_parties;
-- DROP TRIGGER IF EXISTS trg_rate_limit_match_moments     ON public.match_moments;
-- DROP FUNCTION IF EXISTS public.enforce_insert_rate_limit();
-- DROP FUNCTION IF EXISTS public.rate_limit_consume(UUID, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.rate_limit_request_role();
-- REVERSAL-A-END
--   then re-run migration 099 in full (restores the previous
--   check_rate_limit body; its cron step is idempotent), then:
-- REVERSAL-B-BEGIN
-- DROP FUNCTION IF EXISTS public.rate_limit_gc(INT);
-- DROP FUNCTION IF EXISTS public.rate_limit_ceiling(TEXT, TEXT);
-- NOTIFY pgrst, 'reload schema';
-- REVERSAL-B-END
-- Rows written to public.rate_limits under the '<table>_insert' keys are
-- harmless after reversal and age out within a day.
