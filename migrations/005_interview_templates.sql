-- ============================================
-- Interview templates: a saved stage plan (which stages, in what order, how long, which question or random,
-- which runbook) that can be reused for single and bulk interview creation.
-- Run after 004_stages_and_runbooks.sql, as the table owner. Safe to run more than once.
-- ============================================
CREATE TABLE IF NOT EXISTS interview_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level VARCHAR(50) NOT NULL DEFAULT 'Mid',
  stages JSONB NOT NULL,                    -- [{key, budgetMin, graceMin, earlyDoneAfterMin, mode, itemId, runbookId}]
  version INTEGER NOT NULL DEFAULT 1,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interview_templates_org ON interview_templates(org_id);
