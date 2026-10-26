// Scores are computed and stored on a 1 to 5 scale (that is what the scoring model and the hire thresholds use).
// People read them on a 0 to 100 scale: 1 is 0, 3 is 50, 5 is 100. This is the only place that converts.
export const MAX_SCORE = 100;

/** 1..5 to 0..100 (whole number). Out-of-range and non-numeric values are clamped; null/undefined stay null. */
export function toHundred(score: number | null | undefined): number | null {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return null;
  const v = ((Number(score) - 1) / 4) * 100;
  return Math.max(0, Math.min(100, Math.round(v + 1e-9)));
}

/** 0..100 back to 1..5 (two decimals). */
export function fromHundred(points: number): number {
  return Math.round((1 + (Math.max(0, Math.min(100, points)) / 100) * 4) * 100) / 100;
}

/** The mark used when a batch has not set its own: the hire threshold of 3.0 out of 5 is 50 out of 100. */
export const DEFAULT_PASS_MARK = 50;

export type PassVerdict = "pass" | "fail";

export function passVerdict(overall: number | null | undefined, passMark: number): PassVerdict | null {
  const s = toHundred(overall);
  return s === null ? null : s >= passMark ? "pass" : "fail";
}
