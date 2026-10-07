// Shared interview clock helpers. The server is the source of truth for time —
// the AI must never be able to end an interview early on its own.

/** The AI may only close the interview once this many seconds (or fewer) remain. */
export const END_GRACE_SECONDS = 120;

/**
 * Seconds left in the interview, or null if it hasn't started / has no usable duration
 * (in which case we can't judge and callers should not block on time).
 */
export function getRemainingSeconds(interview: { startedAt?: string | null; duration?: number | null }): number | null {
  if (!interview.startedAt || !interview.duration) return null;
  const startedMs = new Date(interview.startedAt).getTime();
  if (Number.isNaN(startedMs)) return null;
  const elapsedSec = Math.floor((Date.now() - startedMs) / 1000);
  return Math.max(0, interview.duration * 60 - elapsedSec);
}

/** True if the AI's [END_INTERVIEW] signal should be honoured right now. */
export function canEndNow(interview: { startedAt?: string | null; duration?: number | null }): boolean {
  const remaining = getRemainingSeconds(interview);
  if (remaining === null) return true; // can't judge — the client timer still enforces the limit
  return remaining <= END_GRACE_SECONDS;
}
