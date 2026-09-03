-- 089: make the tier benefits real (v9.5).
--
-- WHY:
--   docs/tier-promises-audit.md, 2026-08-31: of the eleven benefits the
--   paywall sells, exactly one was enforced (the clip quota). Not a single
--   RLS policy on prod referenced tier. This migration is the server half of
--   closing that gap; the copy half lives in TIER_CONFIG and choose-plan.
--
--   The constraint that shapes all of it: migration 070 removed the paywall
--   from creation flows on direct UAT feedback ("these pymt screens are
--   supposed to come up upon signing in, not when one is trying to create a
--   fan group or watch party"). That decision stands. Nothing here gates
--   creating a fan group, posting a clip, joining, or RSVPing.
--
-- WHAT:
--   1. Private watch parties become a Home Team benefit. Creating a PUBLIC
--      party stays open to everyone -- the create flow never dead-ends.
--   2. The full RSVP roster becomes a private-party benefit. A host of a
--      public party wants the headcount; a host of a private party wants to
--      know who is actually coming, who is a maybe, and who dropped out.
--   3. get_public_profiles returns subscription_tier, so a badge can render
--      on other people's content. Without this the client cannot see any
--      tier but its own (users RLS is own-profile-only, mig 001) and a
--      "badge on your profile" is visible to nobody but you.
--   4. chat_rooms.owner_is_featured, maintained by trigger, so Discover can
--      float MVP-owned groups without the client needing to read anyone's
--      tier.
--
-- SAFETY:
--   * Every gate added here is on a PRIVATE-visibility path or a read of
--     someone else's data. Public creation paths are untouched.
--   * owner_is_featured is a denormalised boolean about a ROOM, not a
--     disclosure of the owner's billing status. It says "rank me higher",
--     not "this person pays".
--   * The tier column feeding all of this is written only by the RevenueCat
--     webhook and protected by the mig 082 immutability trigger.

-- ─── 1. Private watch parties require Home Team ────────────────────
-- Preserves the existing creator_id + WC-event conditions verbatim; adds
-- one disjunct. Public parties: unchanged, open to all.
DROP POLICY IF EXISTS watch_parties_insert ON public.watch_parties;
CREATE POLICY watch_parties_insert ON public.watch_parties
  FOR INSERT TO authenticated
  WITH CHECK (
    creator_id = auth.uid()
    AND (
      event_id IS DISTINCT FROM 'e0000000-0000-0000-0000-000000002026'::uuid
      OR public.has_wc_access(auth.uid())
    )
    AND (
      visibility IS DISTINCT FROM 'private'
      OR public.has_tier_or_higher(auth.uid(), 'home_team')
    )
  );

COMMENT ON POLICY watch_parties_insert ON public.watch_parties IS
  'Anyone may create a PUBLIC watch party (mig 070 decision). Private parties require Home Team or above — see migration 089 and docs/tier-promises-audit.md.';

-- ─── 2. Full RSVP roster is a private-party benefit ────────────────
-- Before: the host of ANY party saw every RSVP by name and status.
-- After:  host of a PRIVATE party still does. Host of a public party sees
--         what guests see -- the 'going' list plus the three totals, which
--         is the headcount they actually act on.
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
  v_visibility TEXT;
  v_is_host BOOLEAN;
  v_full_roster BOOLEAN;
BEGIN
  SELECT wp.creator_id, wp.visibility
    INTO v_creator, v_visibility
  FROM public.watch_parties wp
  WHERE wp.id = p_party_id;

  v_is_host := (v_creator IS NOT NULL AND v_creator = p_viewer_id);

  -- The benefit is the roster, and the roster belongs to private parties.
  -- Totals stay available to everyone either way, so a public host never
  -- loses the number they came for.
  v_full_roster := v_is_host AND v_visibility = 'private';

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
      v_full_roster
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
  'Attendees + totals. The full roster (going/maybe/cant_go by name) is returned to the host of a PRIVATE party only; public-party hosts and all guests get the going list plus totals. See migration 089.';

-- ─── 3. Public profiles carry the tier, so badges can render ───────
-- Return type changes, so this is a DROP + CREATE rather than REPLACE.
-- Callers select by key, and the new column is additive, so existing
-- consumers (mapClipToDisplay and the feed surfaces) are unaffected.
DROP FUNCTION IF EXISTS public.get_public_profiles(UUID[]);
CREATE FUNCTION public.get_public_profiles(p_user_ids UUID[])
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  subscription_tier TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.auth_id       AS user_id,
    u.display_name,
    u.avatar_url,
    -- Reviewer accounts resolve to 'mvp' here for the same reason they do
    -- in get_user_tier: a reviewer must be able to SEE the badges they paid
    -- to look for.
    CASE
      WHEN public.is_reviewer_account(u.auth_id) THEN 'mvp'
      ELSE COALESCE(u.subscription_tier, 'free')
    END AS subscription_tier
  FROM public.users u
  -- The [1:200] slice is load-bearing and predates this migration: it caps
  -- how much work one feed page can ask for. Preserved verbatim.
  WHERE u.auth_id = ANY(p_user_ids[1:200]);
$$;

GRANT EXECUTE ON FUNCTION public.get_public_profiles(UUID[]) TO authenticated, anon;

COMMENT ON FUNCTION public.get_public_profiles(UUID[]) IS
  'Batch display-name/avatar/tier lookup for feed surfaces. Tier is exposed so Home Team and MVP badges render on other people''s content — a badge only its owner can see is not a badge. See migrations 086 and 089.';

-- ─── 4. Discover: float MVP-owned groups ───────────────────────────
-- Denormalised onto the room so the existing client query can order by it
-- without reading anyone's tier. Two triggers keep it honest: one for new
-- rooms, one for when the webhook moves a user between tiers.
ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS owner_is_featured BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.chat_rooms.owner_is_featured IS
  'TRUE when the room owner is MVP or above. Ranking hint for Discover, maintained by trigger — deliberately a fact about the ROOM, not a disclosure of the owner''s billing status. See migration 089.';

CREATE INDEX IF NOT EXISTS chat_rooms_featured_idx
  ON public.chat_rooms (owner_is_featured DESC, member_count DESC);

CREATE OR REPLACE FUNCTION public.set_chat_room_featured()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.owner_is_featured := public.has_tier_or_higher(NEW.owner_id, 'mvp');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_rooms_set_featured ON public.chat_rooms;
CREATE TRIGGER chat_rooms_set_featured
  BEFORE INSERT ON public.chat_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.set_chat_room_featured();

CREATE OR REPLACE FUNCTION public.sync_featured_rooms_for_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
    UPDATE public.chat_rooms
    SET owner_is_featured = public.has_tier_or_higher(NEW.auth_id, 'mvp')
    WHERE owner_id = NEW.auth_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_sync_featured_rooms ON public.users;
CREATE TRIGGER users_sync_featured_rooms
  AFTER UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_featured_rooms_for_user();

-- Backfill for rooms that predate the column.
UPDATE public.chat_rooms r
SET owner_is_featured = public.has_tier_or_higher(r.owner_id, 'mvp')
WHERE r.owner_is_featured IS DISTINCT FROM public.has_tier_or_higher(r.owner_id, 'mvp');

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- A free user cannot create a private party, but CAN create a public one:
--   SET LOCAL role authenticated;  -- as a free user
--   INSERT INTO watch_parties (creator_id, visibility, ...) VALUES (auth.uid(), 'private', ...);
--   -- expect: 42501 new row violates row-level security
--   INSERT INTO watch_parties (creator_id, visibility, ...) VALUES (auth.uid(), 'public', ...);
--   -- expect: success
--
--   -- Public-party host sees going-only; private-party host sees everything:
--   SELECT status, display_name FROM get_watch_party_attendees_v2('<public-party>', '<host>');
--   SELECT status, display_name FROM get_watch_party_attendees_v2('<private-party>', '<host>');
--
--   -- Tier reaches the feed:
--   SELECT * FROM get_public_profiles(ARRAY['<some-auth-id>']::uuid[]);
--   -- expect: a subscription_tier column
--
--   -- Featured flag tracks the webhook:
--   SELECT owner_is_featured, count(*) FROM chat_rooms GROUP BY 1;
