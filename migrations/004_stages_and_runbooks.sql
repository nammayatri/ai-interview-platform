-- ============================================
-- Stages (Part A / DSA / Puzzle) and reusable interview runbooks
-- Run after 003_dsa_review.sql, as the table owner. Safe to run more than once.
-- ============================================

-- Problems are now either Part A questions (the candidate's own solution is reviewed) or DSA problems (solved live).
ALTER TABLE problems ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'dsa';
-- Problems already used as the subject of a submission were Part A questions.
UPDATE problems SET kind = 'parta' WHERE id IN (SELECT problem_id FROM submissions WHERE is_primary AND problem_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_problems_org_kind ON problems(org_id, kind);

-- Each stage keeps its own scratchpad once it ends.
ALTER TABLE interview_phases ADD COLUMN IF NOT EXISTS scratchpad TEXT;

-- Reusable "how the AI asks" runbooks, one library per stage type.
CREATE TABLE IF NOT EXISTS runbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('parta','dsa','puzzle')),
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,
  probes JSONB NOT NULL DEFAULT '[]',
  rubric JSONB NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_runbooks_org_kind ON runbooks(org_id, kind);

-- Interviews created before this change reviewed a submission in the phase called 'dsa'; that stage is now 'parta'.
-- Transcript and events first (they are found through the old phase row), then the phase itself.
UPDATE transcript_entries SET phase_key = 'parta'
  WHERE phase_key = 'dsa' AND interview_id IN (SELECT interview_id FROM interview_phases WHERE phase_key = 'dsa' AND config ? 'primarySubmissionId');
UPDATE interview_events SET phase_key = 'parta'
  WHERE phase_key = 'dsa' AND interview_id IN (SELECT interview_id FROM interview_phases WHERE phase_key = 'dsa' AND config ? 'primarySubmissionId');
UPDATE interview_phases SET phase_key = 'parta' WHERE phase_key = 'dsa' AND config ? 'primarySubmissionId';
