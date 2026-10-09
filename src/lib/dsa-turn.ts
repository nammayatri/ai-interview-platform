// Server-side orchestration of one DSA Review conversation turn.
//   prepareDsaTurn  -> saves the candidate message, resolves/advances the phase, builds the phase-scoped prompt
//   finalizeDsaTurn -> parses markers from the model output and applies them (assess, hint, phase done, end)
// Used by /api/ai-speak-stream, /api/ai-speak and /api/ai-response so every entry point behaves the same.
import { buildInterviewPrompt, stripThinking } from "./ai";
import { getOrgAISettings } from "./ai-settings";
import { canEndNow } from "./interview-time";
import {
  decideMarkers,
  nextUnlockedHint,
  parseMarkers,
  resolvePhase,
  sanitizeCandidateText,
  type ParsedMarkers,
  type PhaseKey,
  type PhaseResolution,
  type PhaseRow,
} from "./phase-engine";
import {
  activateFirstPhase,
  advancePhase,
  appendHintUse,
  getPhases,
  getScratchpad,
  hasEvent,
  incrementWeakAnswers,
  logEvent,
  saveScratchpad,
  type PhaseTransition,
} from "./phase-store";
import { phaseMaterial } from "./phase-config";
import { LIMITS, type Hint } from "./runbook";
import { addTranscriptEntry, getPhaseTranscript, type Interview, type TranscriptEntry } from "./store";
import { pool } from "./db";

export interface DsaTurnInput {
  /** The candidate's new message. Saved to the transcript unless skipSave. */
  candidateText?: string | null;
  skipSave?: boolean;
  /** Ephemeral candidate line shown to the model but never saved (silence nudge). */
  ephemeralText?: string | null;
  trigger?: "phase_open";
  scratchpad?: string;
}

export interface DsaTurnPrep {
  messages: { role: string; content: string }[];
  interview: Interview;
  /** Phase this turn is spoken in; null when every phase is over (closing turn). */
  phase: PhaseRow | null;
  resolution: PhaseResolution;
  unlockedHint: Hint | null;
  expectAssess: boolean;
  /** Set when the hard cap moved the interview to the next phase before this turn. */
  priorTransition: PhaseTransition | null;
}

export interface PhaseInfo {
  key: PhaseKey | null;
  status: string;
  elapsedMin: number;
  budgetMin: number;
  remainingTotalMin: number;
}

export interface DsaTurnResult {
  text: string;
  endInterview: boolean;
  phase: PhaseInfo;
  phaseTransition?: { from: PhaseKey; to: PhaseKey | null; reason: string; opened: boolean };
  hintUsed?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function isDsaReview(interview: { roundType?: string }): boolean {
  return interview.roundType === "DSA Review";
}

/** Stores the scratchpad (sanitised, capped). Logs an event only when the content changed. */
export async function persistScratchpad(interviewId: string, content: string, phaseKey: PhaseKey | null): Promise<string> {
  const clean = sanitizeCandidateText(String(content ?? "")).slice(0, LIMITS.scratchpadChars);
  const current = await getScratchpad(interviewId);
  if (clean !== current) {
    await saveScratchpad(interviewId, clean);
    await logEvent(pool, interviewId, phaseKey, "scratchpad", { content: clean });
  }
  return clean;
}

const ladderOf = (phase: PhaseRow): Hint[] => phaseMaterial(phase).hintLadder;

export function phaseInfo(phases: PhaseRow[], interview: { startedAt: string | null; duration: number }, now = new Date()): PhaseInfo {
  const res = resolvePhase(phases, interview, now);
  return {
    key: res.current ? res.current.phaseKey : null,
    status: res.current ? res.current.status : "none",
    elapsedMin: round1(res.elapsedInPhaseMin),
    budgetMin: res.current?.budgetMin ?? 0,
    remainingTotalMin: round1(res.remainingTotalMin),
  };
}

export async function prepareDsaTurn(interview: Interview, input: DsaTurnInput): Promise<DsaTurnPrep> {
  const now = new Date();
  let phases = interview.phases && interview.phases.length ? interview.phases : await getPhases(interview.id);

  // Defensive: the start route normally activates the first phase.
  if (phases.length > 0 && phases.every((p) => p.status === "pending")) {
    await activateFirstPhase(interview.id, now);
    phases = await getPhases(interview.id);
  }

  let scratchpad = "";
  const activeKey = (phases.find((p) => p.status === "active")?.phaseKey ?? null) as PhaseKey | null;
  if (typeof input.scratchpad === "string") scratchpad = await persistScratchpad(interview.id, input.scratchpad, activeKey);
  else scratchpad = interview.scratchpad || "";

  // Save the candidate message under the phase that was active when they spoke.
  const candidateText = sanitizeCandidateText((input.candidateText || "").trim());
  if (candidateText && !input.skipSave && input.trigger !== "phase_open") {
    await addTranscriptEntry(interview.id, { role: "candidate", text: candidateText, timestamp: now.toISOString() }, activeKey);
  }

  const view = { startedAt: interview.startedAt, duration: interview.duration };
  let resolution = resolvePhase(phases, view, now);
  let priorTransition: PhaseTransition | null = null;
  // A phase without grace (the puzzle) would otherwise go straight from "running" to "cut off", never giving
  // the AI a turn to wrap up. Give it exactly one wrap-up turn, then apply the hard cap on the next one.
  if (resolution.action === "force_end" && resolution.current && resolution.current.graceMin === 0) {
    if (!(await hasEvent(interview.id, resolution.current.phaseKey, "wrap_requested"))) {
      await logEvent(pool, interview.id, resolution.current.phaseKey, "wrap_requested", {});
      resolution = { ...resolution, action: "request_wrap" };
    }
  }
  if (resolution.action === "force_end" && resolution.current) {
    priorTransition = await advancePhase(interview.id, "hard_cap", { expectedKey: resolution.current.phaseKey, now });
    phases = await getPhases(interview.id);
    resolution = resolvePhase(phases, view, now);
    scratchpad = ""; // the next stage starts with an empty scratchpad
  }

  const phase = resolution.current;
  const history: Pick<TranscriptEntry, "role" | "text">[] = phase ? await getPhaseTranscript(interview.id, phase.phaseKey) : [];
  const ephemeral = sanitizeCandidateText((input.ephemeralText || "").trim());
  const promptHistory = ephemeral ? [...history, { role: "candidate" as const, text: ephemeral }] : history;

  const unlockedHint = phase
    ? nextUnlockedHint(ladderOf(phase), phase.hintsUsed.map((h) => h.order), resolution.elapsedInPhaseMin, phase.weakAnswers)
    : null;

  const enriched: Interview = { ...interview, phases, scratchpad };
  const settings = await getOrgAISettings(interview.orgId);
  const messages = buildInterviewPrompt(enriched, promptHistory as TranscriptEntry[], settings, { resolution, unlockedHint, scratchpad });

  const last = history[history.length - 1];
  return {
    messages,
    interview: enriched,
    phase,
    resolution,
    unlockedHint,
    expectAssess: !!phase && !ephemeral && !!last && last.role === "candidate",
    priorTransition,
  };
}

/** Applies the model output. `raw` may still contain thinking text and markers. */
export async function finalizeDsaTurn(prep: DsaTurnPrep, raw: string): Promise<DsaTurnResult> {
  const { interview, phase, resolution } = prep;
  const id = interview.id;
  const markers: ParsedMarkers = parseMarkers(stripThinking(raw));
  const text = markers.clean;
  const phaseKey = phase ? phase.phaseKey : null;

  // The AI may close the interview in the final minutes, or when no phase is left to run.
  const hasEndSignal = markers.endInterview && (canEndNow(interview) || phase === null);
  if (markers.endInterview && !hasEndSignal) {
    console.warn(`[DSA] Ignored early [END_INTERVIEW] for ${id}`);
  }

  let entryId: number | null = null;
  if (text) entryId = await addTranscriptEntry(id, { role: "ai", text, timestamp: new Date().toISOString() }, phaseKey);

  let hintUsed: number | undefined;
  let transition: PhaseTransition | null = null;

  if (phase) {
    const d = decideMarkers(markers, {
      unlockedHintOrder: prep.unlockedHint ? prep.unlockedHint.order : null,
      elapsedInPhaseMin: resolution.elapsedInPhaseMin,
      // A phase without a configured threshold (the puzzle): require half its budget before an early [PHASE_DONE] counts.
      earlyDoneAfterMin: phase.earlyDoneAfterMin ?? (phase.budgetMin ? Math.floor(phase.budgetMin / 2) : null),
      action: resolution.action,
      expectAssess: prep.expectAssess,
    });

    if (prep.expectAssess && markers.assess) {
      await logEvent(pool, id, phaseKey, "assess", { value: markers.assess });
      if (d.countWeak) await incrementWeakAnswers(phase.id);
    } else if (d.missingAssess) {
      await logEvent(pool, id, phaseKey, "assess_missing", {});
    }

    if (d.acceptHint && markers.hint !== undefined) {
      await appendHintUse(phase.id, { order: markers.hint, atMin: round1(resolution.elapsedInPhaseMin), transcriptEntryId: entryId });
      await logEvent(pool, id, phaseKey, "hint_used", { order: markers.hint, transcriptEntryId: entryId });
      hintUsed = markers.hint;
    } else if (d.hintViolation) {
      await logEvent(pool, id, phaseKey, "hint_violation", { claimed: markers.hint, unlocked: prep.unlockedHint ? prep.unlockedHint.order : null });
    }

    // When the interview ends, the route calls finishInterview, which closes the phases.
    if (!hasEndSignal && d.acceptPhaseDone) {
      transition = await advancePhase(id, "ai_done", { expectedKey: phase.phaseKey });
    } else if (!hasEndSignal && d.phaseDoneIgnored) {
      await logEvent(pool, id, phaseKey, "phase_done_ignored", { elapsedMin: round1(resolution.elapsedInPhaseMin) });
    }
  }

  const phasesNow = await getPhases(id);
  const base: DsaTurnResult = {
    text,
    endInterview: hasEndSignal,
    phase: phaseInfo(phasesNow, interview),
    ...(hintUsed !== undefined ? { hintUsed } : {}),
  };
  if (transition) {
    base.phaseTransition = { from: transition.from, to: transition.to, reason: transition.reason, opened: false };
  } else if (prep.priorTransition) {
    // The hard cap moved us on before this turn, so this turn already is the new phase's opening.
    base.phaseTransition = { from: prep.priorTransition.from, to: prep.priorTransition.to, reason: prep.priorTransition.reason, opened: true };
  }
  return base;
}
