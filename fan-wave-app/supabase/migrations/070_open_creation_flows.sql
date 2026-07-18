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
