// The strike limit at which proctoring ends an interview.
// PROCTORING_ENFORCE=false turns the limit off: events are still recorded and reported, but no interview is ended
// and the candidate sees no strike counter or ban. Read at runtime, no rebuild needed.
export function proctoringEnforced(): boolean {
  return (process.env.PROCTORING_ENFORCE || "true").toLowerCase() !== "false";
}

/** Weighted strikes allowed before the interview ends; unlimited when enforcement is off. */
export function maxProctoringStrikes(): number {
  if (!proctoringEnforced()) return Number.MAX_SAFE_INTEGER;
  return parseInt(process.env.MAX_PROCTORING_STRIKES || process.env.NEXT_PUBLIC_MAX_PROCTORING_STRIKES || "25");
}
