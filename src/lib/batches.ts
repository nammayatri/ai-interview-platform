// Interview batches: one shared join link for many candidates. Pure helpers here (window maths, validation, the
// public view); the database work lives in the API routes.
import { randomBytes } from "crypto";
import { stagesDuration, validateStages, type StagePlan } from "./runbook";

import { DEFAULT_LATE_ENTRY_MIN, DEFAULT_OPENS_BEFORE_MIN } from "./batches-defaults";
export { DEFAULT_LATE_ENTRY_MIN, DEFAULT_OPENS_BEFORE_MIN };
export const MAX_OPENS_BEFORE_MIN = 24 * 60;
export const MAX_LATE_ENTRY_MIN = 240;
export const MAX_BATCH_CANDIDATES = 5000;

export interface BatchTiming {
  startsAt: string | Date;
  opensBeforeMin: number;
  lateEntryMin: number;
  isClosed: boolean;
}

/**
 * not_open:  before registration opens
 * open:      registration is open, the test has not started yet (candidates register, check their setup, wait)
 * live:      the test has started and candidates can still enter
 * closed:    entry is over (late-entry time passed) or the admin closed the batch
 */
export type BatchPhase = "not_open" | "open" | "live" | "closed";

const ms = (min: number) => min * 60_000;
const t = (d: string | Date) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

export function batchWindow(b: BatchTiming) {
  const startsAt = t(b.startsAt);
  return { opensAt: startsAt - ms(b.opensBeforeMin), startsAt, closesAt: startsAt + ms(b.lateEntryMin) };
}

export function batchPhase(b: BatchTiming, now: number = Date.now()): BatchPhase {
  if (b.isClosed) return "closed";
  const w = batchWindow(b);
  if (now < w.opensAt) return "not_open";
  if (now < w.startsAt) return "open";
  if (now <= w.closesAt) return "live";
  return "closed";
}

/** The candidate's link must outlive the batch: the latest start plus the longest interview, with a day of slack. */
export function interviewExpiry(b: Pick<BatchTiming, "startsAt" | "lateEntryMin">, durationMin: number): Date {
  return new Date(t(b.startsAt) + ms(b.lateEntryMin + durationMin) + 24 * 60 * 60_000);
}

export function newJoinCode(): string {
  return randomBytes(9).toString("base64url"); // 12 url-safe characters
}

export interface BatchInput {
  name: string;
  templateId: string;
  role: string;
  startsAt: Date;
  opensBeforeMin: number;
  lateEntryMin: number;
  maxCandidates: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wholeNumber = (v: unknown, fallback: number) => (v === undefined || v === null || v === "" ? fallback : Number(v));

export function validateBatchInput(raw: any, now: number = Date.now()): { ok: true; value: BatchInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = String(raw?.name ?? "").trim();
  if (!name) errors.push("Give the batch a name");
  if (name.length > 255) errors.push("The batch name is too long");
  const templateId = String(raw?.templateId ?? "");
  if (!UUID.test(templateId)) errors.push("Choose a template");
  const role = String(raw?.role ?? "").trim() || "Software Engineer";
  if (role.length > 255) errors.push("The role is too long");
  const startsAt = new Date(raw?.startsAt);
  if (Number.isNaN(startsAt.getTime())) errors.push("Choose the start date and time");
  else if (startsAt.getTime() < now - 60_000) errors.push("The start time is in the past");
  const opensBeforeMin = wholeNumber(raw?.opensBeforeMin, DEFAULT_OPENS_BEFORE_MIN);
  if (!Number.isInteger(opensBeforeMin) || opensBeforeMin < 0 || opensBeforeMin > MAX_OPENS_BEFORE_MIN) errors.push(`Registration can open 0 to ${MAX_OPENS_BEFORE_MIN} minutes before the start`);
  const lateEntryMin = wholeNumber(raw?.lateEntryMin, DEFAULT_LATE_ENTRY_MIN);
  if (!Number.isInteger(lateEntryMin) || lateEntryMin < 0 || lateEntryMin > MAX_LATE_ENTRY_MIN) errors.push(`Late entry can be 0 to ${MAX_LATE_ENTRY_MIN} minutes`);
  let maxCandidates: number | null = null;
  if (raw?.maxCandidates !== undefined && raw?.maxCandidates !== null && raw?.maxCandidates !== "") {
    maxCandidates = Number(raw.maxCandidates);
    if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > MAX_BATCH_CANDIDATES) errors.push(`The candidate limit must be 1 to ${MAX_BATCH_CANDIDATES}`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, templateId, role, startsAt, opensBeforeMin, lateEntryMin, maxCandidates } };
}

// ─── Candidate registration ────────────────────────────────────────────────

export interface RegistrationInput { name: string; email: string; phone: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRegistration(raw: { name?: unknown; email?: unknown; phone?: unknown }): { ok: true; value: RegistrationInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim();
  const email = String(raw.email ?? "").trim();
  const phone = String(raw.phone ?? "").trim();
  if (name.length < 2) errors.name = "Enter your full name";
  else if (name.length > 100) errors.name = "That name is too long";
  if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "Enter a valid email address";
  const digits = phone.replace(/\D/g, "");
  if (!/^[+\d][\d\s\-()]*$/.test(phone) || digits.length < 7 || digits.length > 15) errors.phone = "Enter a valid phone number (7 to 15 digits)";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, phone } };
}

// ─── What the public join page may know ────────────────────────────────────

export interface PublicBatch {
  name: string;
  orgName: string;
  phase: BatchPhase;
  opensAt: string;
  startsAt: string;
  closesAt: string;
  /** Server clock, so the countdown does not depend on the candidate's own clock. */
  serverNow: string;
  requiresPartA: boolean;
  durationMin: number;
  stageLabels: string[];
}

const STAGE_LABEL: Record<string, string> = { parta: "Part A review", dsa: "DSA problem", puzzle: "Reasoning puzzle" };

export function publicBatchView(b: BatchTiming & { name: string; stages: StagePlan[] }, orgName: string, now: number = Date.now()): PublicBatch {
  const w = batchWindow(b);
  return {
    name: b.name,
    orgName,
    phase: batchPhase(b, now),
    opensAt: new Date(w.opensAt).toISOString(),
    startsAt: new Date(w.startsAt).toISOString(),
    closesAt: new Date(w.closesAt).toISOString(),
    serverNow: new Date(now).toISOString(),
    requiresPartA: b.stages.some((s) => s.key === "parta"),
    durationMin: stagesDuration(b.stages),
    stageLabels: b.stages.map((s) => STAGE_LABEL[s.key] || s.key),
  };
}

/** Stored stages are re-checked before use, the same way a template is. */
export function readStoredStages(raw: unknown): StagePlan[] | null {
  if (!Array.isArray(raw)) return null;
  const v = validateStages(raw, stagesDuration(raw as StagePlan[]));
  return v.ok ? v.value : null;
}

export { formatCountdown } from "./countdown";
