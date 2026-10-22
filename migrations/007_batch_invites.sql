-- ============================================
-- Batch invitations: the admin uploads a CSV or Excel list of candidate emails for a batch, the app emails each one the
-- link and the times, and the batch page tracks per person: invited, email sent or failed, logged in (registered),
-- started, completed. Also lets a batch be archived. Run after 006_interview_batches.sql, as the table owner. Safe to run more than once.
-- ============================================
CREATE TABLE IF NOT EXISTS interview_batch_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES interview_batches(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  email_status VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,
  email_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_invites_email ON interview_batch_invites(batch_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_batch_invites_batch ON interview_batch_invites(batch_id);

ALTER TABLE interview_batches ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
