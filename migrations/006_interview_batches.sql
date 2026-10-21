-- ============================================
-- Interview batches: one shared join link for many candidates. The admin picks a template and a start time; the
-- link opens for registration some minutes before the start. Each registration creates a normal interview (tied to
-- the batch through interviews.batch_id) that cannot be started before the batch start time.
-- Run after 005_interview_templates.sql, as the table owner. Safe to run more than once.
-- ============================================
CREATE TABLE IF NOT EXISTS interview_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  join_code VARCHAR(40) NOT NULL UNIQUE,          -- unguessable part of the public link /join/<code>
  template_id UUID REFERENCES interview_templates(id) ON DELETE SET NULL,
  template_name VARCHAR(255) NOT NULL DEFAULT '',
  stages JSONB NOT NULL,                          -- copy of the template's stages when the batch was created
  level VARCHAR(50) NOT NULL DEFAULT 'Mid',
  role VARCHAR(255) NOT NULL DEFAULT 'Software Engineer',
  starts_at TIMESTAMPTZ NOT NULL,
  opens_before_min INTEGER NOT NULL DEFAULT 10,   -- registration opens this long before starts_at
  late_entry_min INTEGER NOT NULL DEFAULT 15,     -- candidates may still start this long after starts_at
  max_candidates INTEGER,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interview_batches_org ON interview_batches(org_id);

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES interview_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_interviews_batch ON interviews(batch_id);
-- One registration per email per batch (also settles two people registering at the same moment).
CREATE UNIQUE INDEX IF NOT EXISTS uq_interviews_batch_email ON interviews(batch_id, lower(candidate_email)) WHERE batch_id IS NOT NULL;
