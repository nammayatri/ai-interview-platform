// Phase engine for the DSA Review round. Pure functions, no database access.
import {
  CLOSE_RESERVE_MIN,
  type DsaPhaseConfig,
  type DsaPoolEntry,
  type Hint,
  type PartAPhaseConfig,
  type PoolEntry,
  type PuzzlePhaseConfig,
} from "./runbook";

export { CLOSE_RESERVE_MIN };

export type PhaseKey = "parta" | "dsa" | "puzzle";
export type PhaseStatus = "pending" | "active" | "completed" | "skipped";
export type EndReason =
  | "ai_done"
  | "hard_cap"
  | "forced"
  | "interview_end"
  | "skipped_no_time"
  | "skipped_no_pool";

export interface HintUse {
  order: number;
  atMin: number;
  transcriptEntryId: number | null;
}

export interface PhaseRow {
  id: string;
  interviewId: string;
  phaseKey: PhaseKey;
  sequence: number;
  status: PhaseStatus;
  budgetMin: number | null;
  graceMin: number;
  earlyDoneAfterMin: number | null;
  minRemainingMin: number | null;
  startedAt: string | null;
  endedAt: string | null;
  endReason: EndReason | null;
  config: PartAPhaseConfig | DsaPhaseConfig | PuzzlePhaseConfig;
  selectedPuzzleId: string | null;
  hintsUsed: HintUse[];
  weakAnswers: number;
  scoreWeight: number;
  scorecard: any | null;
  /** The stage's own scratchpad, snapshotted when the stage ends. */
  scratchpad: string;
}

export interface PhaseResolution {
  current: PhaseRow | null;
  elapsedInPhaseMin: number;
  remainingTotalMin: number;
  action: "none" | "request_wrap" | "force_end";
}

const MS_PER_MIN = 60_000;

export function resolvePhase(
  phases: PhaseRow[],
  interview: { startedAt: string | null; duration: number },
  now: Date
): PhaseResolution {
  const startedMs = interview.startedAt ? new Date(interview.startedAt).getTime() : NaN;
  const remainingTotalMin = Number.isNaN(startedMs)
    ? interview.duration
    : Math.max(0, interview.duration - (now.getTime() - startedMs) / MS_PER_MIN);

  const current = phases.find((p) => p.status === "active") || null;
  if (!current || !current.startedAt) {
    return { current, elapsedInPhaseMin: 0, remainingTotalMin, action: "none" };
  }
  const elapsedInPhaseMin = Math.max(0, (now.getTime() - new Date(current.startedAt).getTime()) / MS_PER_MIN);

  let action: PhaseResolution["action"] = "none";
  if (current.budgetMin !== null && current.budgetMin !== undefined) {
    if (elapsedInPhaseMin >= current.budgetMin + (current.graceMin || 0)) action = "force_end";
    else if (elapsedInPhaseMin >= current.budgetMin) action = "request_wrap";
  }
  return { current, elapsedInPhaseMin, remainingTotalMin, action };
}

// ─── Puzzle selection ───────────────────────────────────────────────────────

function hashSeed(seed: string): number {
  // FNV-1a
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick (seeded by the interview) so a reload or retry chooses the same item. */
export function pickSeeded<T>(items: T[], seed: string): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(mulberry32(hashSeed(seed))() * items.length)];
}

/** DSA stage: the interviewer's specific problem, or a seeded random one from the pool. */
export function selectDsaProblem(pool: DsaPoolEntry[], seed: string, selection: "random" | "specific"): DsaPoolEntry | null {
  if (selection === "specific") return pool[0] ?? null;
  return pickSeeded(pool, seed);
}

export function selectPuzzle(
  pool: PoolEntry[],
  remainingMin: number,
  seed: string,
  selection: "random" | "ordered" | "specific" = "random"
): PoolEntry | null {
  if (!pool.length) return null;
  // An explicitly chosen puzzle always runs; its stage time just caps how long it gets.
  if (selection === "specific") return pool[0];
  const fitting = pool.filter((p) => p.runbook.expectedMin <= remainingMin);
  if (fitting.length > 0) {
    if (selection === "ordered") return fitting[0];
    return pickSeeded(fitting, seed);
  }
  const shortest = pool.reduce((a, b) => (b.runbook.expectedMin < a.runbook.expectedMin ? b : a));
  return shortest.runbook.expectedMin <= remainingMin + 3 ? shortest : null;
}

// ─── Hints ──────────────────────────────────────────────────────────────────

/**
 * The single hint the AI may deliver right now, or null. Ladders are sequential:
 * only the lowest-order unused hint is ever a candidate, so hint n+1 can never be
 * in the prompt before hint n has been used.
 */
export function nextUnlockedHint(ladder: Hint[], used: number[], elapsedMin: number, weakAnswers: number): Hint | null {
  const sorted = ladder.slice().sort((a, b) => a.order - b.order);
  const next = sorted.find((h) => used.indexOf(h.order) === -1);
  if (!next) return null;
  if (next.notBeforeMin !== undefined && elapsedMin < next.notBeforeMin) return null;
  if (next.afterWeakAnswers !== undefined && weakAnswers < next.afterWeakAnswers) return null;
  return next;
}

// ─── Markers ────────────────────────────────────────────────────────────────

export type Assessment = "on_track" | "weak" | "off_track";

export interface ParsedMarkers {
  clean: string;
  assess?: Assessment;
  hint?: number;
  phaseDone: boolean;
  endInterview: boolean;
}

const ANY_MARKER = /\[\s*(ASSESS|HINT|PHASE_DONE|END_INTERVIEW)\s*(?::\s*([^\]\n]*?))?\s*\]/gi;

/** Removes every marker without interpreting it (used per sentence while streaming). */
export function stripMarkers(text: string): string {
  return text.replace(ANY_MARKER, " ").replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

export function parseMarkers(text: string): ParsedMarkers {
  const out: ParsedMarkers = { clean: "", phaseDone: false, endInterview: false };
  const re = new RegExp(ANY_MARKER.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].toUpperCase();
    const arg = (m[2] || "").trim();
    if (name === "ASSESS") {
      const v = arg.toLowerCase();
      if (v === "on_track" || v === "weak" || v === "off_track") out.assess = v;
    } else if (name === "HINT") {
      const n = parseInt(arg, 10);
      if (Number.isInteger(n) && n > 0 && out.hint === undefined && /^\d+$/.test(arg)) out.hint = n;
    } else if (name === "PHASE_DONE") {
      out.phaseDone = true;
    } else if (name === "END_INTERVIEW") {
      out.endInterview = true;
    }
  }
  out.clean = stripMarkers(text);
  return out;
}

/**
 * Candidate-authored text (scratchpad, typed chat) must never carry something that
 * looks like a marker into the transcript context: any [UPPERCASE...] token is removed.
 */
export function sanitizeCandidateText(text: string): string {
  return text.replace(/\[\s*[A-Z][A-Z0-9_]{2,}\s*(?::[^\]\n]*)?\]/g, "");
}

// ─── Marker policy (decides what the server may act on) ────────────────────

export interface MarkerDecision {
  acceptHint: boolean;
  hintViolation: boolean;
  acceptPhaseDone: boolean;
  phaseDoneIgnored: boolean;
  countWeak: boolean;
  missingAssess: boolean;
}

export function decideMarkers(
  markers: ParsedMarkers,
  ctx: {
    unlockedHintOrder: number | null;
    elapsedInPhaseMin: number;
    earlyDoneAfterMin: number | null;
    action: PhaseResolution["action"];
    expectAssess: boolean;
  }
): MarkerDecision {
  const acceptHint = markers.hint !== undefined && ctx.unlockedHintOrder !== null && markers.hint === ctx.unlockedHintOrder;
  const hintViolation = markers.hint !== undefined && !acceptHint;
  let acceptPhaseDone = false;
  if (markers.phaseDone) {
    acceptPhaseDone = ctx.action !== "none" || ctx.earlyDoneAfterMin === null || ctx.elapsedInPhaseMin >= ctx.earlyDoneAfterMin;
  }
  return {
    acceptHint,
    hintViolation,
    acceptPhaseDone,
    phaseDoneIgnored: markers.phaseDone && !acceptPhaseDone,
    countWeak: markers.assess === "weak" || markers.assess === "off_track",
    missingAssess: ctx.expectAssess && markers.assess === undefined,
  };
}
