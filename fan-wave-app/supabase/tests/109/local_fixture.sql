\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE public.users(auth_id uuid primary key, display_name text);
CREATE TABLE public.watch_parties(id uuid primary key, creator_id uuid, visibility text, moderation_status text DEFAULT 'approved', event_id uuid, capacity int DEFAULT 50, rsvp_count int DEFAULT 0);
CREATE TABLE public.watch_party_rsvps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), watch_party_id uuid REFERENCES public.watch_parties(id), user_id uuid, status text NOT NULL CHECK (status IN ('going','interested','declined')), created_at timestamptz DEFAULT now(), UNIQUE(watch_party_id,user_id));
CREATE FUNCTION public.blocked_user_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid WHERE false $$;
CREATE FUNCTION public.has_wc_access(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
\ir ../../migrations/109_secure_attendees_and_rsvp_status.sql
BEGIN;
INSERT INTO public.users VALUES ('00000000-0000-0000-0000-000000000001','Host'), ('00000000-0000-0000-0000-000000000002','Guest');
INSERT INTO public.watch_parties(id,creator_id,visibility) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','public'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','private');
INSERT INTO public.watch_party_rsvps(watch_party_id,user_id,status) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','interested'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','declined');
DO $$ BEGIN
 IF has_function_privilege('anon','public.get_watch_party_attendees_v2(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon execute leaked'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
   PERFORM public.get_watch_party_attendees_v2('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'anon call allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; host_flag boolean; BEGIN
 SELECT count(*) INTO n FROM public.get_watch_party_attendees_v2('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
 IF n != 0 THEN RAISE EXCEPTION 'private stranger leak'; END IF;
 SELECT is_host INTO host_flag FROM public.get_watch_party_attendees_v2('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
 IF host_flag IS DISTINCT FROM false THEN RAISE EXCEPTION 'spoofed host accepted'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.uid','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result record; BEGIN
 SELECT * INTO STRICT result FROM public.get_watch_party_attendees_v2('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
 IF NOT result.is_host OR result.status != 'interested' OR result.total_maybe != 1 THEN RAISE EXCEPTION 'host own Maybe missing'; END IF;
 SELECT * INTO result FROM public.rsvp_to_watch_party('10000000-0000-0000-0000-000000000001','cant_go');
 IF result.status != 'declined' THEN RAISE EXCEPTION 'legacy alias not normalized'; END IF;
 SELECT * INTO STRICT result FROM public.get_watch_party_attendees_v2('10000000-0000-0000-0000-000000000001',null);
 IF result.total_cant_go != 1 OR result.status != 'declined' THEN RAISE EXCEPTION 'declined count mismatch'; END IF;
 PERFORM public.rsvp_to_watch_party('10000000-0000-0000-0000-000000000001','going');
 PERFORM public.rsvp_to_watch_party('10000000-0000-0000-0000-000000000001','interested');
 PERFORM public.rsvp_to_watch_party('10000000-0000-0000-0000-000000000001','declined');
 SELECT * INTO STRICT result FROM public.get_watch_party_attendees_v2('10000000-0000-0000-0000-000000000001',null);
 IF result.total_cant_go != 1 OR result.total_maybe != 0 OR result.total_going != 0 THEN RAISE EXCEPTION 'cycle totals incorrect'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: anon denied, private stranger denied, spoof ignored, own Maybe visible, legacy alias and canonical cycle/totals correct' AS result;
