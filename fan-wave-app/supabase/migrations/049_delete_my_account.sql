-- 049: in-app account deletion RPC for Apple Guideline 5.1.1(v)
--
-- Apple rejected build 1.0.0 (8) on 2026-06-11 because Fan Sphere supports
-- sign-up but did not offer in-app account deletion. Per Apple's policy,
-- apps with account creation must offer immediate (not deferred) account
-- deletion with a one-tap path inside the app, plus full purge of the
-- user's personal data on the backend.
--
-- This RPC is called by the client from the Delete Account screen. It runs
-- as SECURITY DEFINER (owned by supabase_admin) so it can write to auth.users
-- which authenticated callers cannot touch directly. The function derives
-- the caller's identity from auth.uid() — it cannot be tricked into deleting
-- a different user because there's no parameter.
--
-- Order of operations:
--   1. Resolve the caller's public.users.id (most child tables reference
--      this, not auth.users.id).
--   2. Delete user-owned content (clips, comments, messages, etc.) and
--      memberships/RSVPs/follows. Most child FKs are unconstrained, so
--      we delete explicitly to avoid orphan rows.
--   3. Delete the public.users row.
--   4. Delete the auth.users row, which cascades to auth.identities and
--      auth.sessions via Supabase's own internal triggers.
--
-- We deliberately do NOT cascade-delete watch_parties or chat_rooms the
-- user CREATED, only their memberships/RSVPs. Owned groups would orphan
-- other members; owned watch parties would orphan RSVPed attendees.
-- Instead, both have their owner column nulled (`owner_id` / `creator_id`)
-- and Fan Sphere's UI shows "Deleted user" in those slots — content
-- continuity preserved for other users while the deleting user's personal
-- record is gone. This is consistent with Apple's intent: the *user* is
-- deleted, not the community they participated in.
--
-- chat_rooms.owner_id and watch_parties.creator_id were originally NOT NULL
-- (migrations 002 and 003). This migration relaxes both to nullable so the
-- "transfer or orphan" outcome described above is even possible. Neither
-- column has an FK constraint (only an in-app uuid reference), so dropping
-- NOT NULL has no impact on existing rows or other constraints.

ALTER TABLE public.chat_rooms    ALTER COLUMN owner_id   DROP NOT NULL;
ALTER TABLE public.watch_parties ALTER COLUMN creator_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_auth_id   UUID := auth.uid();
  v_user_id   UUID;
BEGIN
  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_user_id FROM public.users WHERE auth_id = v_auth_id;
  IF v_user_id IS NULL THEN
    -- Edge case: auth row exists but no public.users mirror. Still purge
    -- the auth row so the account can no longer log in.
    DELETE FROM auth.users WHERE id = v_auth_id;
    RETURN;
  END IF;

  -- ── User-owned content + interactions ─────────────────────────────
  DELETE FROM public.clip_comments     WHERE user_id   = v_user_id;
  DELETE FROM public.clip_likes        WHERE user_id   = v_user_id;
  DELETE FROM public.media_clips       WHERE user_id   = v_user_id;
  DELETE FROM public.match_moments     WHERE user_id   = v_user_id;
  DELETE FROM public.moment_reactions  WHERE user_id   = v_user_id;
  DELETE FROM public.messages          WHERE user_id   = v_user_id;
  DELETE FROM public.chat_room_members WHERE user_id   = v_user_id;
  DELETE FROM public.watch_party_rsvps WHERE user_id   = v_user_id;
  DELETE FROM public.user_team_follows WHERE user_id   = v_user_id;
  DELETE FROM public.user_follows
         WHERE follower_id = v_user_id OR following_id = v_user_id;
  DELETE FROM public.user_blocks
         WHERE blocker_id  = v_user_id OR blocked_id   = v_user_id;
  DELETE FROM public.user_streaks      WHERE user_id   = v_user_id;
  DELETE FROM public.user_badges       WHERE user_id   = v_user_id;
  DELETE FROM public.banned_members    WHERE user_id   = v_user_id;
  DELETE FROM public.entitlements      WHERE user_id   = v_user_id;
  DELETE FROM public.purchase_events   WHERE user_id   = v_user_id;
  DELETE FROM public.trial_reminders_sent WHERE user_id = v_user_id;
  DELETE FROM public.rate_limits       WHERE user_id   = v_user_id;
  DELETE FROM public.analytics_events  WHERE user_id   = v_user_id;

  -- ── Orphan owned community objects rather than deleting them ──────
  UPDATE public.chat_rooms     SET owner_id   = NULL WHERE owner_id   = v_user_id;
  UPDATE public.watch_parties  SET creator_id = NULL WHERE creator_id = v_user_id;

  -- ── Personal record removal ───────────────────────────────────────
  DELETE FROM public.users WHERE id = v_user_id;
  DELETE FROM auth.users    WHERE id = v_auth_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- Smoke test (do NOT run in prod — deletes the calling user!):
--   SELECT delete_my_account();
