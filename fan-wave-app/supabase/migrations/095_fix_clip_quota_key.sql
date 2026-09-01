-- 095: the clip quota has never once blocked anybody.
--
-- WHY:
--   Reported from the v9.5 Android build 2026-09-01: a free account posted
--   4 clips in 10 minutes. The cap is 3 per rolling 24h.
--
--   check_clip_quota (mig 083) resolves the caller's auth uid to a
--   public.users.id and counts:
--
--       FROM media_clips WHERE user_id = <public.users.id>
--
--   but media_clips.user_id holds the AUTH uid. Every clip in production --
--   all 10 of them, including the 4 just posted -- matches auth.users.id and
--   not one matches public.users.id:
--
--       clips whose user_id matches public.users.id   0
--       clips whose user_id matches auth.users.id    10
--
--   So the count is always 0, remaining is always 3, and the gate has never
--   fired for anyone. Migration 083 asserted the opposite in a comment --
--   "media_clips.user_id references public.users.id (NOT auth.users.id)" --
--   and there is no foreign key on the column (mig 002), so nothing ever
--   contradicted the assumption. The tests could not catch it either: the RPC
--   is correct in isolation, and only real rows reveal which key they carry.
--
--   This matters beyond a quota: "Unlimited clip posting" is the headline
--   Home Team benefit and the only one docs/tier-promises-audit.md found
--   genuinely enforced. It was not. Free and paid were identical.
--
-- WHAT:
--   Count clips under EITHER key. Not a guess about which is correct -- the
--   column has no FK and both shapes exist in the wild, so a quota that only
--   understands one of them is one silent migration away from breaking again.
--   Matching both is correct under either convention.
--
-- WHY IN THE DATABASE:
--   The fix lands server-side, so build 32 (iOS) and version code 20
--   (Android) start enforcing immediately without a new build.
--
-- SAFETY:
--   * Cannot over-count: a given clip carries one key, and a user's auth uid
--     and public.users.id are different values, so the OR cannot double-count
--     the same row.
--   * Home Team / MVP / reviewer still short-circuit to unlimited before any
--     counting happens.

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

  -- The caller passes an auth uid. Resolve the profile id too, then count
  -- against BOTH: media_clips.user_id has no FK and production rows carry the
  -- auth uid, while mig 083 assumed the profile id. Accepting either is the
  -- only version that is right regardless of which convention a writer used.
  SELECT id INTO v_public_users_id
  FROM public.users
  WHERE auth_id = uid;

  SELECT count(*), min(created_at)
  INTO v_used, v_oldest
  FROM public.media_clips
  WHERE created_at > now() - interval '24 hours'
    AND (
      user_id = uid
      OR (v_public_users_id IS NOT NULL AND user_id = v_public_users_id)
    );

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
  'Clip quota for the caller. Free: 3 per rolling 24h. Home Team+: unlimited (9999). Counts media_clips under EITHER the auth uid or the profile id, because that column has no FK and production rows use the auth uid. See migrations 083 and 095.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- The account that just posted 4 clips must now be blocked:
--   SELECT public.check_clip_quota('<auth-uid>');
--   -- expect: {"allowed": false, "remaining": 0, "cap": 3, "resets_at": ...}
--
--   -- A user who has posted nothing is unaffected:
--   -- expect: {"allowed": true, "remaining": 3}
--
--   -- And paid tiers still bypass:
--   -- expect: {"allowed": true, "remaining": 9999, "tier": "mvp"}
