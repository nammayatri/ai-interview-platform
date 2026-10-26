// Per-batch settings (stored in interview_batches.settings): the proctoring rules and the passing mark.
// A missing key means "use the default"; the defaults come from the environment so a deployment without any
// batch settings behaves exactly as before. Pure and client-safe: the database work is in interview-settings.ts.
import { DEFAULT_PASS_MARK } from "./score-scale";

/** Every proctoring check an admin can switch off. */
export const PROCTORING_CHECKS = [
  { key: "faceMissing", label: "Face not visible", help: "Camera cannot see the candidate's face.", events: ["face_missing"] },
  { key: "multipleFaces", label: "More than one person", help: "Another face appears in the camera.", events: ["multiple_faces"] },
  { key: "cameraOff", label: "Camera turned off", help: "The candidate stops their video.", events: ["camera_off"] },
  { key: "screenShare", label: "Screen sharing required", help: "The candidate must share their entire screen; the interview ends if sharing stays off.", events: ["screen_share_stopped"] },
  { key: "fullscreen", label: "Fullscreen exit", help: "Leaving fullscreen mode.", events: ["fullscreen_exit"] },
  { key: "tabSwitch", label: "Tab or window switch", help: "Switching to another tab or app.", events: ["left_screen", "window_blur"] },
  { key: "copyPaste", label: "Copy and paste", help: "Copying from or pasting into the interview.", events: ["copy_attempt", "paste_attempt"] },
  { key: "screenshot", label: "Screenshots", help: "Screenshot key presses.", events: ["screenshot_attempt"] },
  { key: "secondMonitor", label: "Second monitor", help: "An extended display is detected.", events: ["second_monitor"] },
  { key: "devtools", label: "Developer tools", help: "Browser developer tools are open.", events: ["devtools_open"] },
  { key: "virtualCamera", label: "Virtual camera", help: "A virtual or unusual camera is used.", events: ["virtual_camera"] },
  { key: "phoneDetection", label: "Phone or second screen", help: "A bright object that looks like a phone.", events: ["phone_detected"] },
] as const;

export type ProctoringCheckKey = (typeof PROCTORING_CHECKS)[number]["key"];

export interface ProctoringSettings {
  /** End the interview when the strike limit is reached. Off: events are still recorded, nobody is removed. */
  enforce: boolean;
  /** Weighted strikes allowed before the interview ends. */
  maxStrikes: number;
  /** Show the candidate the "Warning x" banner. */
  showWarnings: boolean;
  /** Show the candidate the Mute and Stop Video buttons. */
  allowMediaToggle: boolean;
  /** true: the check runs. false: nothing is recorded, nothing counts. */
  checks: Record<ProctoringCheckKey, boolean>;
}

export interface BatchSettings {
  /** Pass mark out of 100 for the overall score. */
  passMark: number;
  proctoring: ProctoringSettings;
}

export const MAX_STRIKES_LIMIT = 100000;

type Env = Record<string, string | undefined>;

/** The settings a batch gets when nothing is set: the environment variables, exactly as before. */
export function defaultBatchSettings(env: Env = process.env): BatchSettings {
  const maxRaw = parseInt(env.MAX_PROCTORING_STRIKES || env.NEXT_PUBLIC_MAX_PROCTORING_STRIKES || "25", 10);
  const checks = {} as Record<ProctoringCheckKey, boolean>;
  for (const c of PROCTORING_CHECKS) checks[c.key] = true;
  return {
    passMark: DEFAULT_PASS_MARK,
    proctoring: {
      enforce: (env.PROCTORING_ENFORCE || "true").toLowerCase() !== "false",
      maxStrikes: Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(maxRaw, MAX_STRIKES_LIMIT) : 25,
      showWarnings: true,
      allowMediaToggle: (env.ALLOW_MEDIA_TOGGLE || "true").toLowerCase() !== "false",
      checks,
    },
  };
}

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Reads stored JSON on top of the defaults. Never throws: anything unreadable falls back to the default for that key. */
export function normalizeBatchSettings(raw: unknown, env: Env = process.env): BatchSettings {
  const d = defaultBatchSettings(env);
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const p = r.proctoring && typeof r.proctoring === "object" ? (r.proctoring as Record<string, any>) : {};
  const rc = p.checks && typeof p.checks === "object" ? (p.checks as Record<string, unknown>) : {};
  const checks = { ...d.proctoring.checks };
  for (const c of PROCTORING_CHECKS) checks[c.key] = bool(rc[c.key], d.proctoring.checks[c.key]);
  const pass = Number(r.passMark);
  const max = Number(p.maxStrikes);
  return {
    passMark: Number.isFinite(pass) && pass >= 0 && pass <= 100 ? Math.round(pass) : d.passMark,
    proctoring: {
      enforce: bool(p.enforce, d.proctoring.enforce),
      maxStrikes: Number.isInteger(max) && max >= 1 && max <= MAX_STRIKES_LIMIT ? max : d.proctoring.maxStrikes,
      showWarnings: bool(p.showWarnings, d.proctoring.showWarnings),
      allowMediaToggle: bool(p.allowMediaToggle, d.proctoring.allowMediaToggle),
      checks,
    },
  };
}

/** Validates an admin's input (strict: a wrong value is an error, not a silent default). */
export function validateBatchSettings(raw: unknown, env: Env = process.env): { ok: true; value: BatchSettings } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["Settings must be an object"] };
  const r = raw as Record<string, any>;
  if (r.passMark !== undefined) {
    const n = Number(r.passMark);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.push("The passing mark must be 0 to 100");
  }
  const p = r.proctoring;
  if (p !== undefined) {
    if (!p || typeof p !== "object" || Array.isArray(p)) errors.push("Proctoring settings must be an object");
    else {
      if (p.maxStrikes !== undefined) {
        const n = Number(p.maxStrikes);
        if (!Number.isInteger(n) || n < 1 || n > MAX_STRIKES_LIMIT) errors.push(`The strike limit must be a whole number from 1 to ${MAX_STRIKES_LIMIT}`);
      }
      for (const k of ["enforce", "showWarnings", "allowMediaToggle"]) if (p[k] !== undefined && typeof p[k] !== "boolean") errors.push(`${k} must be true or false`);
      if (p.checks !== undefined) {
        if (!p.checks || typeof p.checks !== "object") errors.push("checks must be an object");
        else for (const [k, v] of Object.entries(p.checks)) {
          if (!PROCTORING_CHECKS.some((c) => c.key === k)) errors.push(`Unknown check: ${k}`);
          else if (typeof v !== "boolean") errors.push(`${k} must be true or false`);
        }
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: normalizeBatchSettings(raw, env) };
}

/** Event types whose check is switched off: not recorded and not counted. */
export function disabledEventTypes(s: BatchSettings): string[] {
  return PROCTORING_CHECKS.filter((c) => !s.proctoring.checks[c.key]).flatMap((c) => [...c.events]);
}

export function eventEnabled(s: BatchSettings, type: string): boolean {
  return !disabledEventTypes(s).includes(type);
}

/** The strike limit that applies: unlimited when enforcement is off. */
export function effectiveMaxStrikes(s: BatchSettings): number {
  return s.proctoring.enforce ? s.proctoring.maxStrikes : Number.MAX_SAFE_INTEGER;
}

/** What the candidate's browser needs (no pass mark: the candidate never sees it). */
export function candidateProctoringView(s: BatchSettings) {
  return {
    enforce: s.proctoring.enforce,
    maxStrikes: s.proctoring.maxStrikes,
    showWarnings: s.proctoring.showWarnings,
    allowMediaToggle: s.proctoring.allowMediaToggle,
    checks: s.proctoring.checks,
  };
}
export type CandidateProctoring = ReturnType<typeof candidateProctoringView>;
