// Reads the material of a phase out of its config snapshot, whatever the stage type is.
import type { PhaseRow } from "./phase-engine";
import {
  BUILTIN_RUNBOOKS,
  type DsaPhaseConfig,
  type Hint,
  type PartAPhaseConfig,
  type PuzzlePhaseConfig,
  type RubricCriterion,
  type StageFlow,
} from "./runbook";

export interface PhaseMaterial {
  /** False until a random/pooled phase has been activated and its item chosen. */
  ready: boolean;
  title: string;
  statementMd: string;
  hintLadder: Hint[];
  /** The item's own rubric plus any criteria added by the stage's interview runbook (ids prefixed "rb:"). */
  rubric: RubricCriterion[];
}

/** The interview runbook plugged into this phase; interviews created before runbooks existed fall back to the built-in. */
export function phaseFlow(phase: PhaseRow): StageFlow {
  const stored = (phase.config as { flow?: StageFlow }).flow;
  if (stored && stored.instructions) return stored;
  return { ...BUILTIN_RUNBOOKS[phase.phaseKey], runbookId: null, runbookVersion: 0 };
}

export function phaseMaterial(phase: PhaseRow): PhaseMaterial {
  const flowRubric = (phase.config as { flow?: StageFlow }).flow?.rubric?.map((r) => ({ ...r, id: `rb:${r.id}` })) ?? [];
  if (phase.phaseKey === "parta") {
    const cfg = phase.config as PartAPhaseConfig;
    return { ready: true, title: cfg.problemTitle, statementMd: cfg.runbook.statementMd, hintLadder: cfg.runbook.hintLadder, rubric: [...cfg.runbook.rubric, ...flowRubric] };
  }
  const sel = phase.phaseKey === "dsa" ? (phase.config as DsaPhaseConfig).selected : (phase.config as PuzzlePhaseConfig).selected;
  return sel
    ? { ready: true, title: sel.title, statementMd: sel.runbook.statementMd, hintLadder: sel.runbook.hintLadder, rubric: [...sel.runbook.rubric, ...flowRubric] }
    : { ready: false, title: "", statementMd: "", hintLadder: [], rubric: [] };
}
