-- ============================================
-- DSA Review round: problems, puzzles, submissions, phases, events
-- PostgreSQL 14+ (gen_random_uuid is built in; on PG12 run CREATE EXTENSION pgcrypto first)
-- Run: psql -U postgres -d ai_interview_platform -f migrations/003_dsa_review.sql
-- ============================================

CREATE TABLE IF NOT EXISTS problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  difficulty VARCHAR(20),                 -- easy | medium | hard
  tags TEXT[] NOT NULL DEFAULT '{}',
  runbook JSONB NOT NULL,                 -- ProblemRunbook
  version INTEGER NOT NULL DEFAULT 1,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_problems_org ON problems(org_id);

CREATE TABLE IF NOT EXISTS puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  difficulty VARCHAR(20),
  tags TEXT[] NOT NULL DEFAULT '{}',
  expected_min INTEGER NOT NULL,          -- duplicated from runbook for cheap filtering
  runbook JSONB NOT NULL,                 -- PuzzleRunbook
  version INTEGER NOT NULL DEFAULT 1,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_puzzles_org ON puzzles(org_id);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  problem_id UUID REFERENCES problems(id) ON DELETE SET NULL,
  problem_title VARCHAR(255) NOT NULL,    -- denormalized; survives problem deletion
  language VARCHAR(50),
  code TEXT NOT NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('passed','partial','failed')),
  score NUMERIC,
  tests_passed INTEGER,
  tests_total INTEGER,
  external_url TEXT,                      -- HackerRank report link
  notes TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_submissions_interview ON submissions(interview_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_primary ON submissions(interview_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS interview_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  phase_key VARCHAR(20) NOT NULL,         -- 'dsa' | 'puzzle'
  sequence INTEGER NOT NULL,              -- 1, 2
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | active | completed | skipped
  budget_min INTEGER,                     -- dsa: plan budget; puzzle: set at activation from the selected puzzle
  grace_min INTEGER NOT NULL DEFAULT 0,
  early_done_after_min INTEGER,           -- PHASE_DONE accepted only after this many minutes
  min_remaining_min INTEGER,              -- puzzle only: skip if remaining < this
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_reason VARCHAR(30),                 -- ai_done | hard_cap | forced | interview_end | skipped_no_time | skipped_no_pool
  config JSONB NOT NULL,                  -- snapshot
  selected_puzzle_id UUID,                -- puzzle only
  hints_used JSONB NOT NULL DEFAULT '[]', -- [{order, atMin, transcriptEntryId}]
  weak_answers INTEGER NOT NULL DEFAULT 0,
  score_weight NUMERIC NOT NULL DEFAULT 1, -- share of the rubric roll-up; dsa 0.7, puzzle 0.3 by default
  scorecard JSONB,                        -- PhaseScorecard
  UNIQUE (interview_id, phase_key)
);
CREATE INDEX IF NOT EXISTS idx_phases_interview ON interview_phases(interview_id, sequence);

CREATE TABLE IF NOT EXISTS interview_events (
  id BIGSERIAL PRIMARY KEY,
  interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  phase_key VARCHAR(20),
  type VARCHAR(40) NOT NULL,              -- phase_start, phase_end, hint_used, hint_violation, assess, assess_missing, phase_done_ignored, scratchpad, forced_transition, puzzle_selected
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_interview ON interview_events(interview_id, id);

ALTER TABLE transcript_entries ADD COLUMN IF NOT EXISTS phase_key VARCHAR(20);
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS scratchpad TEXT;

-- round_type on interviews gains the value 'DSA Review'. No column change.
