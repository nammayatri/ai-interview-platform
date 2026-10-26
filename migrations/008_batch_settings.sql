-- ============================================
-- Per-batch settings: the proctoring rules (which checks run, the strike limit, whether the candidate can mute or stop
-- the camera) and the passing mark. Stored as JSON so a new setting never needs a new migration; a missing key means
-- "use the default", and the defaults still come from the environment (PROCTORING_ENFORCE, MAX_PROCTORING_STRIKES,
-- ALLOW_MEDIA_TOGGLE). Changes apply to interviews that are already running within about 15 seconds.
-- Run after 007_batch_invites.sql, as the table owner. Safe to run more than once.
-- ============================================
ALTER TABLE interview_batches ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
