-- Migration 020: add server-side onboarding completion signal.
--
-- Before this, `onboarding_complete` lived only in device AsyncStorage, so any
-- wipe (reinstall, device switch, Expo Go cache clear) forced users through
-- onboarding again. `users.onboarded_at` makes completion the server's truth
-- and survives device resets.
--
-- Back-fill: any user with at least one row in user_team_follows is treated as
-- onboarded using their follow's created_at as the completion time.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

UPDATE users u
SET onboarded_at = (
  SELECT MIN(utf.followed_at)
  FROM user_team_follows utf
  WHERE utf.user_id = u.id
)
WHERE u.onboarded_at IS NULL
  AND EXISTS (
    SELECT 1 FROM user_team_follows utf WHERE utf.user_id = u.id
  );

CREATE INDEX IF NOT EXISTS idx_users_onboarded_at ON users (onboarded_at)
  WHERE onboarded_at IS NOT NULL;
