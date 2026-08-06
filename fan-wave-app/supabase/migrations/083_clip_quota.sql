-- 083: Daily clip-posting quota for free tier (v9.3 launch).
--
-- WHY:
--   The v9.3 freemium model gives every user 3 clips per rolling 24-hour
--   window before hitting the Home Team upgrade sheet. See migration 082
--   for the tier system this leans on. Home Team, MVP, and Business
--   tiers post unlimited.
--
--   Enforcement layer choice: RPC pre-check called from create-clip.tsx
--   before the upload is enqueued. This is client-facing gating, not a
--   security boundary — if a determined user bypasses it via a direct
--   .insert() they can post more than 3/day. For v9.3 we accept this
--   risk (no clients other than our own hit media_clips insert). If we
--   see abuse, v9.4 can add can_post_clip(uid) to the media_clips_insert
--   RLS as a hard gate.
--
--   Rolling-24h vs calendar-day: we picked rolling because it's more
--   user-friendly ("you can post again in 5h 12m") and doesn't require
--   knowing the user's timezone. Reset time returned is the oldest
--   still-counted clip's created_at + 24h.
--
-- WHAT this migration adds:
--   1. check_clip_quota(uid) RPC returning JSONB:
--        { allowed: bool, remaining: int, cap: int, resets_at: timestamptz | null, tier: text }
--      Home Team+ returns { allowed: true, remaining: 9999, cap: 9999 } (unlimited sentinel).
--
-- No RLS change — media_clips_insert stays open per mig 070.

-- ─── check_clip_quota ────────────────────────────────────────────────
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

  -- media_clips.user_id references public.users.id (NOT auth.users.id).
  -- The client passes auth.users.id; resolve it here so callers don't
  -- have to.
  SELECT id INTO v_public_users_id
  FROM public.users
  WHERE auth_id = uid;

  IF v_public_users_id IS NULL THEN
    -- User row hasn't been created yet (fresh signup). No clips
    -- posted → full quota available.
    RETURN jsonb_build_object(
      'allowed',   true,
      'remaining', v_cap,
      'cap',       v_cap,
      'resets_at', NULL,
      'tier',      v_tier
    );
  END IF;

  -- Count clips posted in the rolling 24h window and get the oldest
  -- one so we can compute the reset time.
  SELECT count(*), min(created_at)
  INTO v_used, v_oldest
  FROM public.media_clips
  WHERE user_id = v_public_users_id
    AND created_at > now() - interval '24 hours';

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
  'Returns clip-posting quota for the user. Free tier: 3 clips per rolling 24h. Home Team+: unlimited (9999 sentinel). See migration 083.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Fresh free user (no clips posted) → allowed with full quota:
--   SELECT public.check_clip_quota('<free-user-auth-uid>'::uuid);
--   -- expect: {"allowed": true, "remaining": 3, "cap": 3, "resets_at": null, "tier": "free"}
--
--   -- Free user who posted 3 clips in last 24h → blocked:
--   SELECT public.check_clip_quota('<capped-user-auth-uid>'::uuid);
--   -- expect: {"allowed": false, "remaining": 0, "cap": 3, "resets_at": "2026-08-07T...", "tier": "free"}
--
--   -- Home Team subscriber → unlimited:
--   SELECT public.check_clip_quota('<home-team-uid>'::uuid);
--   -- expect: {"allowed": true, "remaining": 9999, "cap": 9999, "resets_at": null, "tier": "home_team"}
--
--   -- Reviewer → unlimited (even with subscription_tier='free'):
--   SELECT public.check_clip_quota(
--     (SELECT id FROM auth.users WHERE lower(email)='fansphere.reviewer@gmail.com')
--   );
--   -- expect: {"allowed": true, "remaining": 9999, "cap": 9999, "resets_at": null, "tier": "mvp"}
