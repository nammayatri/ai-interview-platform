// Deterministic server-side roll-up of per-phase rubric credits into the five scorecard dimensions.
// Pure module: no model calls, no database.
import { DIMENSIONS, type Dimension, type Hint, type RubricCriterion } from "../runbook";

export type Credit = "met" | "partial" | "missed";
export const CREDIT_VALUE: Record<Credit, number> = { met: 1, partial: 0.5, missed: 0 };

export interface ScoredCriterion {
  id: string;
  credit: Credit;
  evidence: string;
}

export interface RollupPhaseInput {
  key: "parta" | "dsa" | "puzzle";
  scoreWeight: number;
  rubric: RubricCriterion[];
  criteria: ScoredCriterion[];
  hintsUsed: Array<{ order: number }>;
  hintLadder: Hint[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function creditOf(criteria: ScoredCriterion[], id: string): Credit {
  return criteria.find((c) => c.id === id)?.credit ?? "missed";
}

export function hintDiscount(hintsUsed: Array<{ order: number }>, ladder: Hint[]): number {
  return hintsUsed.reduce((sum, u) => sum + (ladder.find((h) => h.order === u.order)?.scoreDiscount ?? 0), 0);
}

function weightedFraction(rubric: RubricCriterion[], criteria: ScoredCriterion[]): number | null {
  const total = rubric.reduce((s, r) => s + r.weight, 0);
  if (rubric.length === 0 || total <= 0) return null;
  return rubric.reduce((s, r) => s + r.weight * CREDIT_VALUE[creditOf(criteria, r.id)], 0) / total;
}

export function rawFraction(p: RollupPhaseInput): number {
  return weightedFraction(p.rubric, p.criteria) ?? 0;
}

export function phaseCreditFraction(p: RollupPhaseInput): number {
  return Math.max(0, rawFraction(p) - hintDiscount(p.hintsUsed, p.hintLadder));
}

/** 1..5 scale. */
export function phaseScore(p: RollupPhaseInput): number {
  return 1 + 4 * clamp01(phaseCreditFraction(p));
}

export function dimFraction(p: RollupPhaseInput, dim: Dimension): number | null {
  const mapped = p.rubric.filter((r) => r.mapsTo === dim);
  const f = weightedFraction(mapped, p.criteria);
  if (f === null) return null;
  return Math.max(0, f - hintDiscount(p.hintsUsed, p.hintLadder));
}

export interface RollupResult {
  /** Dimension value on the 1..5 scale for dimensions that have rubric coverage; absent otherwise. */
  scores: Partial<Record<Dimension, number>>;
  sources: Record<Dimension, "rubric" | "global">;
}

/**
 * Combine phases with their score_weight, renormalised over the scored phases that actually
 * map criteria to the dimension. A skipped puzzle therefore gives the DSA phase full weight.
 */
export function rollupDimensions(phases: RollupPhaseInput[]): RollupResult {
  const scores: Partial<Record<Dimension, number>> = {};
  const sources = {} as Record<Dimension, "rubric" | "global">;
  for (const dim of DIMENSIONS) {
    let weightSum = 0;
    let acc = 0;
    for (const p of phases) {
      const f = dimFraction(p, dim);
      if (f === null) continue;
      weightSum += p.scoreWeight;
      acc += p.scoreWeight * f;
    }
    if (weightSum > 0) {
      scores[dim] = Math.round((1 + 4 * clamp01(acc / weightSum)) * 10) / 10;
      sources[dim] = "rubric";
    } else {
      sources[dim] = "global";
    }
  }
  return { scores, sources };
}
