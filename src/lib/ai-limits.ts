// Token and time limits for model calls, readable from environment variables so they can be tuned without a deploy
// of new code. Read at call time. A missing, non-numeric or out-of-range value falls back to the default.

export function envInt(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    console.warn(`[ai-limits] Ignoring ${name}="${raw}" (expected an integer from ${min} to ${max}); using ${fallback}`);
    return fallback;
  }
  return n;
}

export const aiLimits = {
  /** Scoring: tokens for ONE stage's rubric scoring. A reasoning model spends part of this thinking. */
  phaseScoringMaxTokens: () => envInt("SUMMARY_AI_PHASE_MAX_TOKENS", 8000, 500, 64000),
  /** Scoring: tokens for the final scorecard (summary, strengths, evidence). */
  finalScoringMaxTokens: () => envInt("SUMMARY_AI_MAX_TOKENS", 12000, 500, 64000),
  /** Scoring: the most tokens the single retry after an empty reply may use. */
  scoringRetryMaxTokens: () => envInt("SUMMARY_AI_RETRY_MAX_TOKENS", 16000, 500, 64000),
  /** Scoring: how long one scoring call may take, in milliseconds. */
  scoringTimeoutMs: () => envInt("SUMMARY_AI_TIMEOUT_MS", 600000, 5000, 1800000),
  /** Scoring: how many scoring model calls one pod runs at the same time. */
  scoringConcurrency: () => envInt("SCORING_CONCURRENCY", 4, 1, 50),
  /** Scoring: tries per model call when the failure looks temporary (rate limit, gateway error, dropped connection). */
  scoringAttempts: () => envInt("SCORING_ATTEMPTS", 5, 1, 10),
  /** Live interview: tokens for one AI reply. Set AI_CHAT_MAX_TOKENS to override every call site. */
  chatMaxTokens: (fallback: number) => envInt("AI_CHAT_MAX_TOKENS", fallback, 50, 8000),
};
