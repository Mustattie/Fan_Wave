-- Behavioural tests for migration 103 (tier-aware rate-limit ceilings).
-- Run by scripts/test-migration-103.mjs against a scratch Postgres that
-- has fixture_schema.sql + the real 099, 102, 073 (RSVP RPC) and 103
-- applied. Every block is one transaction; a failed ASSERT aborts the run
-- (psql ON_ERROR_STOP). Each block ends with a NOTICE 'ok: ...' that the
-- runner collects.

\set ON_ERROR_STOP on
\set QUIET on

-- ─── Helpers ───────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS t103;
GRANT USAGE ON SCHEMA t103 TO anon, authenticated, service_role;

-- Act as a PostgREST request: JWT claims + the matching database role.
CREATE OR REPLACE FUNCTION t103.as_user(p_uid UUID, p_role TEXT DEFAULT 'authenticated')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN json_build_object('role', p_role)::text
         ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
  PERFORM set_config('request.jwt.claim.sub',  COALESCE(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('role', CASE WHEN p_role IN ('anon', 'authenticated', 'service_role') THEN p_role ELSE 'none' END, true);
END $$;

-- Act as operator tooling: no JWT, session role.
CREATE OR REPLACE FUNCTION t103.as_operator()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;

-- Ledger rows for a user+action, read past RLS.
CREATE OR REPLACE FUNCTION t103.consumed(p_uid UUID, p_action TEXT)
RETURNS INT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(count), 0)::int FROM public.rate_limits WHERE user_id = p_uid AND action = p_action;
$$;

CREATE OR REPLACE FUNCTION t103.new_user(p_tier TEXT DEFAULT 'free', p_email TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v, COALESCE(p_email, v::text || '@example.test'));
  INSERT INTO public.users (auth_id, display_name, subscription_tier) VALUES (v, 'u', p_tier);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION t103.new_room()
RETURNS UUID LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.chat_rooms DEFAULT VALUES RETURNING id;
$$;

CREATE OR REPLACE FUNCTION t103.new_party(p_creator UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.watch_parties (creator_id, title) VALUES (p_creator, 'party') RETURNING id;
$$;

-- Seeds a clip as operator tooling (no JWT). Runs with whatever claims
-- the session carries — after a previous block that is the empty string
-- SET LOCAL leaves behind, which is exactly the shape 102's fixed
-- enforce_clip_quota must tolerate.
CREATE OR REPLACE FUNCTION t103.new_clip(p_owner UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.media_clips (user_id, title, media_url) VALUES (p_owner, 'clip', 'https://x/' || gen_random_uuid()::text) RETURNING id;
$$;

-- ─── T1: shape — 8 AFTER INSERT triggers, locked-down helpers ──────────
DO $$
DECLARE
  v_n INT;
  v_before INT;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE (tgtype & 2) <> 0)
    INTO v_n, v_before
    FROM pg_trigger
   WHERE tgname LIKE 'trg_rate_limit_%' AND NOT tgisinternal;
  ASSERT v_n = 8, format('expected 8 rate-limit triggers, found %s', v_n);
  ASSERT v_before = 0, format('%s rate-limit triggers are BEFORE; all must be AFTER', v_before);

  ASSERT (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_rate_limit_match_moments') = 1, 'match_moments trigger missing';

  -- 8 triggers all INSERT-only, row-level
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgname LIKE 'trg_rate_limit_%' AND NOT tgisinternal
     AND (tgtype & 1) = 1 AND (tgtype & 4) = 4 AND (tgtype & 8) = 0 AND (tgtype & 16) = 0;
  ASSERT v_n = 8, 'every rate-limit trigger must be FOR EACH ROW ... INSERT only';

  -- first-draft overloads are gone
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rate_limit_ceiling' AND pronargs = 1), 'old rate_limit_ceiling(text) still present';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rate_limit_consume' AND pronargs = 2), 'old rate_limit_consume(uuid,text) still present';

  -- helpers are not callable by end-user roles
  ASSERT NOT has_function_privilege('anon',          'public.rate_limit_ceiling(text,text)', 'execute'), 'anon can call rate_limit_ceiling';
  ASSERT NOT has_function_privilege('authenticated', 'public.rate_limit_ceiling(text,text)', 'execute'), 'authenticated can call rate_limit_ceiling';
  ASSERT NOT has_function_privilege('authenticated', 'public.rate_limit_consume(uuid,text,text)', 'execute'), 'authenticated can call rate_limit_consume';
  ASSERT NOT has_function_privilege('authenticated', 'public.rate_limit_gc(int)', 'execute'), 'authenticated can call rate_limit_gc';
  ASSERT NOT has_function_privilege('authenticated', 'public.rate_limit_request_role()', 'execute'), 'authenticated can call rate_limit_request_role';
  ASSERT NOT has_function_privilege('anon',          'public.check_rate_limit(uuid,text,int,int)', 'execute'), 'anon can call check_rate_limit (099 revoked it)';
  ASSERT     has_function_privilege('authenticated', 'public.check_rate_limit(uuid,text,int,int)', 'execute'), 'authenticated lost check_rate_limit';

  -- one source of truth: the pre-check reads rate_limit_ceiling
  ASSERT pg_get_functiondef('public.check_rate_limit(uuid,text,int,int)'::regprocedure) LIKE '%rate_limit_ceiling%', 'check_rate_limit does not read rate_limit_ceiling';

  -- the ceilings table says what the header says
  ASSERT (SELECT max_count FROM public.rate_limit_ceiling('clip_post', 'free')) = 5;
  ASSERT (SELECT max_count FROM public.rate_limit_ceiling('media_clips_insert', 'home_team')) = 30;
  ASSERT (SELECT max_count FROM public.rate_limit_ceiling('media_clips_insert', 'business')) = 30;
  ASSERT (SELECT window_seconds FROM public.rate_limit_ceiling('rsvp', 'mvp')) = 86400;
  ASSERT (SELECT max_count FROM public.rate_limit_ceiling('watch_party_rsvps_insert', 'free')) = 20;
  ASSERT (SELECT max_count FROM public.rate_limit_ceiling('messages_insert', 'mvp')) = 60;
  ASSERT (SELECT max_count FROM public.rate_limit_ceiling('something_new', NULL)) = 60;
  ASSERT (SELECT window_seconds FROM public.rate_limit_ceiling('something_new', 'free')) = 60;
  RAISE NOTICE 'ok: T1 shape — 8 AFTER INSERT triggers, helpers locked down, one source of truth';
END $$;

-- ─── T2: free user, messages 60/min then PT429 ─────────────────────────
DO $$
DECLARE
  u UUID := t103.new_user('free');
  r UUID := t103.new_room();
  v_state TEXT; v_msg TEXT; v_hint TEXT; v_detail TEXT;
BEGIN
  PERFORM t103.as_user(u);
  FOR i IN 1..60 LOOP
    INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'm' || i);
  END LOOP;
  BEGIN
    INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'one too many');
    RAISE EXCEPTION 'the 61st message was accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT, v_detail = PG_EXCEPTION_DETAIL;
  END;
  ASSERT v_hint = 'rate_limited:messages_insert', format('hint was %s', v_hint);
  ASSERT v_msg ILIKE '%rate limit%' AND v_msg ILIKE '%too many%', format('message not recognisable by the k6 taxonomy: %s', v_msg);
  ASSERT v_detail = 'limit 60 per 60 seconds', format('detail was %s', v_detail);
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'messages_insert') = 60, format('ledger has %s, expected 60', t103.consumed(u, 'messages_insert'));
  ASSERT (SELECT count(*) FROM public.messages WHERE user_id = u) = 60, 'the refused row was not rolled back';
  RAISE NOTICE 'ok: T2 free user — 60 messages pass, 61st raises PT429 with hint/detail, row rolled back';
END $$;

-- ─── T3: operator / service paths are exempt; fallback identity works ──
DO $$
DECLARE
  u UUID := t103.new_user('free');
  r UUID := t103.new_room();
BEGIN
  -- no JWT at all (SQL editor, Management API, pg_cron, migrations)
  PERFORM t103.as_operator();
  FOR i IN 1..70 LOOP
    INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'ops' || i);
  END LOOP;
  ASSERT t103.consumed(u, 'messages_insert') = 0, 'operator inserts consumed budget';

  -- claims present but empty string (setting was reset in-session)
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'empty-claims');
  ASSERT t103.consumed(u, 'messages_insert') = 0, 'empty-claims insert consumed budget';

  -- service_role
  PERFORM t103.as_user(NULL, 'service_role');
  FOR i IN 1..70 LOOP
    INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'svc' || i);
  END LOOP;
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'messages_insert') = 0, 'service_role inserts consumed budget';

  -- authenticated role with no subject: the row column is the fallback
  PERFORM t103.as_user(NULL, 'authenticated');
  INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'no-sub');
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'messages_insert') = 1, 'row-column fallback did not count';

  -- a JWT subject beats the row column (099's rule: identity is the JWT)
  PERFORM t103.as_user(u);
  INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, gen_random_uuid(), 'spoofed-user_id');
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'messages_insert') = 2, 'JWT subject was not the bucket key';
  RAISE NOTICE 'ok: T3 operator, empty-claims and service_role inserts are free; JWT subject keys the bucket';
END $$;

-- ─── T4: the anon role is limited too ──────────────────────────────────
DO $$
DECLARE
  u UUID := t103.new_user('free');
  r UUID := t103.new_room();
BEGIN
  PERFORM t103.as_user(u, 'anon');
  INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'anon');
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'messages_insert') = 1, 'anon insert was not counted';
  RAISE NOTICE 'ok: T4 anon-role writes draw from the budget';
END $$;

-- ─── T5: clips — free stays on the 102 quota, paid and reviewer get 30/h
DO $$
DECLARE
  f  UUID := t103.new_user('free');
  p  UUID := t103.new_user('home_team');
  rv UUID := t103.new_user('free', 'fansphere.reviewer@gmail.com');
  v_state TEXT; v_hint TEXT;
BEGIN
  -- free: 3 per 24 h from migration 102, and the refused 4th costs nothing
  PERFORM t103.as_user(f);
  FOR i IN 1..3 LOOP
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (f, 'c', 'https://x/f' || i);
  END LOOP;
  BEGIN
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (f, 'c', 'https://x/f4');
    RAISE EXCEPTION 'free 4th clip accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  END;
  ASSERT v_hint = 'clip_quota_exceeded', format('free 4th clip refused with hint %s, expected the 102 quota', v_hint);
  PERFORM t103.as_operator();
  ASSERT t103.consumed(f, 'media_clips_insert') = 3, 'a quota-refused clip consumed rate budget';

  -- home_team: 30 per hour, 31st is PT429 — NOT 42501, so no paywall copy
  PERFORM t103.as_user(p);
  FOR i IN 1..30 LOOP
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (p, 'c', 'https://x/p' || i);
  END LOOP;
  BEGIN
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (p, 'c', 'https://x/p31');
    RAISE EXCEPTION 'paid 31st clip accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  END;
  ASSERT v_hint = 'rate_limited:media_clips_insert';
  PERFORM t103.as_operator();
  ASSERT (SELECT count(*) FROM public.media_clips WHERE user_id = p) = 30;

  -- reviewer account (free row, allow-listed email) is treated as mvp
  PERFORM t103.as_user(rv);
  FOR i IN 1..30 LOOP
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (rv, 'c', 'https://x/r' || i);
  END LOOP;
  BEGIN
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (rv, 'c', 'https://x/r31');
    RAISE EXCEPTION 'reviewer 31st clip accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN NULL;
  END;
  PERFORM t103.as_operator();
  RAISE NOTICE 'ok: T5 clips — free capped by 102 at 3 (no rate cost), home_team and reviewer get 30/h then PT429';
END $$;

-- ─── T6: upserts that update or no-op never consume ────────────────────
DO $$
DECLARE
  u     UUID := t103.new_user('free');
  other UUID := t103.new_user('free');
  clip  UUID := t103.new_clip(other);
  party UUID := t103.new_party(other);
  v_rsvp public.watch_party_rsvps;
BEGIN
  -- toggle_clip_like: like / unlike / like → two real inserts
  PERFORM t103.as_user(u);
  PERFORM public.toggle_clip_like(clip);
  PERFORM public.toggle_clip_like(clip);
  PERFORM public.toggle_clip_like(clip);
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'clip_likes_insert') = 2, format('likes consumed %s, expected 2', t103.consumed(u, 'clip_likes_insert'));

  -- ON CONFLICT DO NOTHING against the existing like, 150 times (ceiling 120)
  PERFORM t103.as_user(u);
  FOR i IN 1..150 LOOP
    INSERT INTO public.clip_likes (clip_id, user_id) VALUES (clip, u) ON CONFLICT (clip_id, user_id) DO NOTHING;
  END LOOP;
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'clip_likes_insert') = 2, 'DO NOTHING upserts consumed budget';

  -- follow_user repeated 100 times (ceiling 60): one real insert
  PERFORM t103.as_user(u);
  FOR i IN 1..100 LOOP
    PERFORM public.follow_user(other);
  END LOOP;
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'user_follows_insert') = 1, 'repeated follow_user consumed budget';

  -- rsvp_to_watch_party: going, then 60 status flips (ceiling 20)
  PERFORM t103.as_user(u);
  v_rsvp := public.rsvp_to_watch_party(party, 'going');
  FOR i IN 1..60 LOOP
    v_rsvp := public.rsvp_to_watch_party(party, CASE WHEN i % 2 = 1 THEN 'interested' ELSE 'going' END);
  END LOOP;
  -- and the raw ON CONFLICT DO UPDATE shape, 30 times
  FOR i IN 1..30 LOOP
    INSERT INTO public.watch_party_rsvps (watch_party_id, user_id, status) VALUES (party, u, 'going')
    ON CONFLICT (watch_party_id, user_id) DO UPDATE SET status = EXCLUDED.status;
  END LOOP;
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'watch_party_rsvps_insert') = 1, format('RSVP status changes consumed %s, expected 1', t103.consumed(u, 'watch_party_rsvps_insert'));
  ASSERT (SELECT status FROM public.watch_party_rsvps WHERE watch_party_id = party AND user_id = u) = 'going';
  ASSERT (SELECT rsvp_count FROM public.watch_parties WHERE id = party) = 1, 'RPC recompute of rsvp_count broke';

  -- cancel is a DELETE: free; re-RSVP is a real insert: counted
  PERFORM t103.as_user(u);
  v_rsvp := public.rsvp_to_watch_party(party, 'cancelled');
  v_rsvp := public.rsvp_to_watch_party(party, 'going');
  PERFORM t103.as_operator();
  ASSERT t103.consumed(u, 'watch_party_rsvps_insert') = 2;
  RAISE NOTICE 'ok: T6 upserts — DO NOTHING / DO UPDATE / status flips cost nothing; only real inserts count';
END $$;

-- ─── T7: match_moments now has a ceiling (free 10/h) ───────────────────
DO $$
DECLARE
  u UUID := t103.new_user('free');
  r UUID := t103.new_room();
  v_hint TEXT;
BEGIN
  PERFORM t103.as_user(u);
  FOR i IN 1..10 LOOP
    INSERT INTO public.match_moments (chat_room_id, user_id, moment_type, comment) VALUES (r, u, 'goal', 'x');
  END LOOP;
  BEGIN
    INSERT INTO public.match_moments (chat_room_id, user_id, moment_type, comment) VALUES (r, u, 'goal', 'x');
    RAISE EXCEPTION '11th moment accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  END;
  ASSERT v_hint = 'rate_limited:match_moments_insert';
  PERFORM t103.as_operator();
  RAISE NOTICE 'ok: T7 match_moments — 10/h for free, 11th raises PT429';
END $$;

-- ─── T8: watch_parties — free 10/day, paid 50/day ──────────────────────
DO $$
DECLARE
  f UUID := t103.new_user('free');
  p UUID := t103.new_user('mvp');
BEGIN
  PERFORM t103.as_user(f);
  FOR i IN 1..10 LOOP
    INSERT INTO public.watch_parties (creator_id, title) VALUES (f, 'p' || i);
  END LOOP;
  BEGIN
    INSERT INTO public.watch_parties (creator_id, title) VALUES (f, 'p11');
    RAISE EXCEPTION 'free 11th party accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN NULL;
  END;
  PERFORM t103.as_user(p);
  FOR i IN 1..50 LOOP
    INSERT INTO public.watch_parties (creator_id, title) VALUES (p, 'p' || i);
  END LOOP;
  BEGIN
    INSERT INTO public.watch_parties (creator_id, title) VALUES (p, 'p51');
    RAISE EXCEPTION 'mvp 51st party accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN NULL;
  END;
  PERFORM t103.as_operator();
  ASSERT (SELECT count(*) FROM public.watch_parties WHERE creator_id = f) = 10;
  ASSERT (SELECT count(*) FROM public.watch_parties WHERE creator_id = p) = 50;
  RAISE NOTICE 'ok: T8 watch_parties — free 10/day, mvp 50/day';
END $$;

-- ─── T9: the pre-check through the RPC contract the clients use ────────
-- Tiered actions (clip_post, moment_post, rsvp) are called with NULL
-- numbers, as app/create-clip.tsx, components/MomentsFeed.tsx and
-- app/watch-party/[id].tsx now do, and get their tier's ceiling. Chat
-- keeps sending 60/60 explicitly. A caller may still tighten, never loosen.
DO $$
DECLARE
  f  UUID := t103.new_user('free');
  p  UUID := t103.new_user('home_team');
  p2 UUID := t103.new_user('home_team');
  p3 UUID := t103.new_user('mvp');
  p4 UUID := t103.new_user('home_team');
  f2 UUID := t103.new_user('free');
  v_ok BOOLEAN;
BEGIN
  -- free, NULL numbers: 5 clips, 10 moments, 20 RSVPs
  PERFORM t103.as_user(f);
  FOR i IN 1..5  LOOP ASSERT public.check_rate_limit(f, 'clip_post',   NULL, NULL), format('free clip_post #%s denied', i);   END LOOP;
  ASSERT NOT public.check_rate_limit(f, 'clip_post', NULL, NULL), 'free clip_post #6 allowed';
  FOR i IN 1..10 LOOP ASSERT public.check_rate_limit(f, 'moment_post', NULL, NULL), format('free moment_post #%s denied', i); END LOOP;
  ASSERT NOT public.check_rate_limit(f, 'moment_post', NULL, NULL), 'free moment_post #11 allowed';
  FOR i IN 1..20 LOOP ASSERT public.check_rate_limit(f, 'rsvp',        NULL, NULL), format('free rsvp #%s denied', i);        END LOOP;
  ASSERT NOT public.check_rate_limit(f, 'rsvp', NULL, NULL), 'free rsvp #21 allowed';

  -- home_team, same RPC contract: 30 clips, 60 moments, 100 RSVPs
  PERFORM t103.as_user(p);
  FOR i IN 1..30  LOOP ASSERT public.check_rate_limit(p, 'clip_post',   NULL, NULL), format('paid clip_post #%s denied', i);   END LOOP;
  ASSERT NOT public.check_rate_limit(p, 'clip_post', NULL, NULL), 'paid clip_post #31 allowed';
  FOR i IN 1..60  LOOP ASSERT public.check_rate_limit(p, 'moment_post', NULL, NULL), format('paid moment_post #%s denied', i); END LOOP;
  ASSERT NOT public.check_rate_limit(p, 'moment_post', NULL, NULL), 'paid moment_post #61 allowed';
  FOR i IN 1..100 LOOP ASSERT public.check_rate_limit(p, 'rsvp',        NULL, NULL), format('paid rsvp #%s denied', i);        END LOOP;
  ASSERT NOT public.check_rate_limit(p, 'rsvp', NULL, NULL), 'paid rsvp #101 allowed';

  -- chat is explicit 60/60 for every tier (fan-group/[id].tsx)
  PERFORM t103.as_user(p3);
  FOR i IN 1..60 LOOP ASSERT public.check_rate_limit(p3, 'message_send', 60, 60), format('mvp message_send #%s denied', i); END LOOP;
  ASSERT NOT public.check_rate_limit(p3, 'message_send', 60, 60), 'mvp message_send #61 allowed';

  -- a build still sending the old literal 5/3600 is honoured as a
  -- tightening (099 rule) — the server never lets a caller loosen
  PERFORM t103.as_user(p2);
  FOR i IN 1..5 LOOP ASSERT public.check_rate_limit(p2, 'clip_post', 5, 3600), format('paid clip_post (client cap 5) #%s denied', i); END LOOP;
  ASSERT NOT public.check_rate_limit(p2, 'clip_post', 5, 3600), 'the explicit client cap was not honoured';

  -- a loosening request (1,000,000 per second) is clamped to the tier
  -- ceiling: a fresh paid user gets 30, not a million
  PERFORM t103.as_user(p4);
  FOR i IN 1..30 LOOP ASSERT public.check_rate_limit(p4, 'clip_post', 1000000, 1), format('paid clip_post (loosening request) #%s denied', i); END LOOP;
  ASSERT NOT public.check_rate_limit(p4, 'clip_post', 1000000, 1), 'a loosening request escaped the tier ceiling';

  -- a client may still tighten below its tier ceiling
  PERFORM t103.as_user(f2);
  ASSERT public.check_rate_limit(f2, 'message_send', 2, 60);
  ASSERT public.check_rate_limit(f2, 'message_send', 2, 60);
  ASSERT NOT public.check_rate_limit(f2, 'message_send', 2, 60), 'tightened ceiling not honoured';

  -- p_user_id is ignored: identity is the JWT
  PERFORM t103.as_operator();
  ASSERT t103.consumed(f2, 'message_send') = 2;
  ASSERT t103.consumed(p,  'clip_post')    = 30;

  -- a request with no subject is denied, not errored (099 rule)
  PERFORM t103.as_user(NULL, 'authenticated');
  ASSERT NOT public.check_rate_limit(gen_random_uuid(), 'message_send', 60, 60), 'NULL uid was allowed';
  PERFORM t103.as_operator();
  RAISE NOTICE 'ok: T9 check_rate_limit via the client contract — free 5/10/20, home_team 30/60/100, chat 60 for all, tighten-only, uid from JWT';
END $$;

-- ─── T10: windows expire ───────────────────────────────────────────────
DO $$
DECLARE
  u UUID := t103.new_user('free');
  r UUID := t103.new_room();
BEGIN
  PERFORM t103.as_user(u);
  FOR i IN 1..60 LOOP
    INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'm');
  END LOOP;
  PERFORM t103.as_operator();
  UPDATE public.rate_limits SET window_start = now() - interval '61 seconds' WHERE user_id = u;
  PERFORM t103.as_user(u);
  INSERT INTO public.messages (chat_room_id, user_id, content) VALUES (r, u, 'after the window');
  PERFORM t103.as_operator();
  RAISE NOTICE 'ok: T10 a full bucket frees up once its window has passed';
END $$;

-- ─── T11: bounded GC keeps one day ─────────────────────────────────────
DO $$
DECLARE
  u UUID := gen_random_uuid();
  v_n INT;
BEGIN
  PERFORM t103.as_operator();
  INSERT INTO public.rate_limits (user_id, action, window_start)
    SELECT u, 'messages_insert', now() - interval '2 days' FROM generate_series(1, 100);
  INSERT INTO public.rate_limits (user_id, action, window_start)
    SELECT u, 'messages_insert', now() - interval '23 hours' FROM generate_series(1, 5);
  v_n := public.rate_limit_gc(40);
  ASSERT v_n = 40, format('gc(40) deleted %s', v_n);
  v_n := public.rate_limit_gc(1000);
  ASSERT v_n = 60, format('second gc deleted %s, expected the remaining 60', v_n);
  ASSERT (SELECT count(*) FROM public.rate_limits WHERE user_id = u) = 5, 'rows inside the one-day retention were removed';
  ASSERT public.rate_limit_gc(NULL) = 0;
  RAISE NOTICE 'ok: T11 rate_limit_gc — bounded, one-day retention';
END $$;

-- ─── T12: PT429 propagates through a SECURITY DEFINER RPC ──────────────
DO $$
DECLARE
  u     UUID := t103.new_user('free');
  host  UUID := t103.new_user('mvp');
  parties UUID[] := '{}';
  v_rsvp public.watch_party_rsvps;
  v_hint TEXT;
  v_last UUID;
BEGIN
  FOR i IN 1..21 LOOP
    parties := parties || t103.new_party(host);
  END LOOP;
  v_last := parties[21];
  PERFORM t103.as_user(u);
  FOR i IN 1..20 LOOP
    v_rsvp := public.rsvp_to_watch_party(parties[i], 'going');
  END LOOP;
  BEGIN
    v_rsvp := public.rsvp_to_watch_party(v_last, 'going');
    RAISE EXCEPTION '21st RSVP accepted';
  EXCEPTION WHEN SQLSTATE 'PT429' THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  END;
  ASSERT v_hint = 'rate_limited:watch_party_rsvps_insert';
  PERFORM t103.as_operator();
  ASSERT (SELECT rsvp_count FROM public.watch_parties WHERE id = v_last) = 0, 'the refused RPC left its rsvp_count update behind';
  ASSERT NOT EXISTS (SELECT 1 FROM public.watch_party_rsvps WHERE watch_party_id = v_last AND user_id = u), 'the refused RSVP row survived';
  RAISE NOTICE 'ok: T12 PT429 propagates through rsvp_to_watch_party and the whole RPC rolls back';
END $$;

-- ─── T13: migration 102 after the claims fix — operator clip inserts ───
DO $$
DECLARE
  f UUID := t103.new_user('free');
  v_hint TEXT;
BEGIN
  -- the free user fills the 102 quota as an end user
  PERFORM t103.as_user(f);
  FOR i IN 1..3 LOOP
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (f, 'c', 'https://x/q' || i);
  END LOOP;
  BEGIN
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (f, 'c', 'https://x/q4');
    RAISE EXCEPTION 'free 4th clip accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  END;
  ASSERT v_hint = 'clip_quota_exceeded';

  -- no JWT at all (SQL editor, Management API): the quota does not apply
  PERFORM t103.as_operator();
  INSERT INTO public.media_clips (user_id, title, media_url) VALUES (f, 'c', 'https://x/ops1');

  -- claims present but '' (what SET LOCAL leaves behind): same, and no
  -- "invalid input syntax for type json"
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  INSERT INTO public.media_clips (user_id, title, media_url) VALUES (f, 'c', 'https://x/ops2');

  -- service_role: exempt as before
  PERFORM t103.as_user(NULL, 'service_role');
  INSERT INTO public.media_clips (user_id, title, media_url) VALUES (f, 'c', 'https://x/ops3');

  -- and the end user is still held at the quota afterwards
  PERFORM t103.as_user(f);
  BEGIN
    INSERT INTO public.media_clips (user_id, title, media_url) VALUES (f, 'c', 'https://x/q5');
    RAISE EXCEPTION 'free 5th clip accepted after operator inserts';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  PERFORM t103.as_operator();
  ASSERT (SELECT count(*) FROM public.media_clips WHERE user_id = f) = 6;
  -- operator inserts also drew nothing from the 103 budget
  ASSERT t103.consumed(f, 'media_clips_insert') = 3;
  RAISE NOTICE 'ok: T13 migration 102 — quota holds for the end user; no-JWT, empty-claims and service_role operator inserts pass';
END $$;
