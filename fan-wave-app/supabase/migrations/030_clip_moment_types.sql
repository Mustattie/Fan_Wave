-- 030: add sport + moment-type tagging to media_clips so the Clips tab
-- post flow can mirror the Post-a-Moment categorization (Touchdown,
-- Three Pointer, Goal, etc.). Both optional — existing clips keep
-- NULL for these columns and render fine.

ALTER TABLE media_clips
  ADD COLUMN IF NOT EXISTS sport_id    TEXT,
  ADD COLUMN IF NOT EXISTS moment_type TEXT;

-- Index sport_id since the Clips feed will likely filter by it.
CREATE INDEX IF NOT EXISTS media_clips_sport_id_idx ON media_clips (sport_id);
