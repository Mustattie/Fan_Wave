-- Fixture for scripts/test-migration-108.mjs: the smallest slice of prod
-- that reproduces the member_count defect. Roles + auth.uid() stub copied
-- from tests/103/fixture_schema.sql; tables, RLS policies and the trigger
-- functions reproduce prod as read on 2026-10-03 (002 + 008 + 015/051
-- policies: chat_rooms_update is owner-only, chat_room_members_insert
-- lets a user insert their own row).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon          NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role  NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.chat_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'public',
  owner_id uuid NOT NULL,
  member_count int NOT NULL DEFAULT 0
);
CREATE TABLE public.chat_room_members (
  chat_room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_room_id, user_id)
);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_rooms, public.chat_room_members TO authenticated, service_role;

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_rooms_select_public ON public.chat_rooms FOR SELECT TO authenticated USING (visibility = 'public');
CREATE POLICY chat_rooms_insert ON public.chat_rooms FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY chat_rooms_update ON public.chat_rooms FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

ALTER TABLE public.chat_room_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_room_members_select ON public.chat_room_members FOR SELECT TO authenticated USING (true);
CREATE POLICY chat_room_members_insert ON public.chat_room_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY chat_room_members_delete ON public.chat_room_members FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 008's functions, verbatim (plain SECURITY INVOKER): the defect under test.
CREATE OR REPLACE FUNCTION public.increment_member_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_rooms
       SET member_count = (
           SELECT COUNT(*) FROM chat_room_members
           WHERE chat_room_id = NEW.chat_room_id
       )
     WHERE id = NEW.chat_room_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.decrement_member_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_rooms
       SET member_count = (
           SELECT COUNT(*) FROM chat_room_members
           WHERE chat_room_id = OLD.chat_room_id
       )
     WHERE id = OLD.chat_room_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chat_room_member_insert
    AFTER INSERT ON public.chat_room_members
    FOR EACH ROW EXECUTE FUNCTION public.increment_member_count();
CREATE TRIGGER trg_chat_room_member_delete
    AFTER DELETE ON public.chat_room_members
    FOR EACH ROW EXECUTE FUNCTION public.decrement_member_count();

-- Seed: one public room owned by OWNER with the owner as its first member
-- (inserted as service_role, the way the app's create-group flow lands it).
INSERT INTO public.chat_rooms (id, name, owner_id, member_count)
VALUES ('cf06ddf9-0000-0000-0000-000000000001', 'Fixture Fans', '11111111-1111-1111-1111-111111111111', 1);
INSERT INTO public.chat_room_members (chat_room_id, user_id, role)
VALUES ('cf06ddf9-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner');
