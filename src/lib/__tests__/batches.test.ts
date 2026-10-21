import { describe, expect, it } from "vitest";
import { batchPhase, batchWindow, formatCountdown, interviewExpiry, newJoinCode, publicBatchView, readStoredStages, validateBatchInput, validateRegistration } from "../batches";

const START = new Date("2026-11-02T11:00:00.000Z").getTime();
const at = (offsetMin: number) => START + offsetMin * 60_000;
const b = { startsAt: new Date(START), opensBeforeMin: 10, lateEntryMin: 15, isClosed: false };

describe("batch window", () => {
  it("opens 10 minutes before the start and closes 15 minutes after", () => {
    const w = batchWindow(b);
    expect(w.opensAt).toBe(at(-10));
    expect(w.startsAt).toBe(at(0));
    expect(w.closesAt).toBe(at(15));
  });
  it("walks through the phases", () => {
    expect(batchPhase(b, at(-60))).toBe("not_open");
    expect(batchPhase(b, at(-10.01))).toBe("not_open");
    expect(batchPhase(b, at(-10))).toBe("open");
    expect(batchPhase(b, at(-0.01))).toBe("open");
    expect(batchPhase(b, at(0))).toBe("live");
    expect(batchPhase(b, at(15))).toBe("live");
    expect(batchPhase(b, at(15.01))).toBe("closed");
  });
  it("is closed whenever the admin closed it", () => {
    expect(batchPhase({ ...b, isClosed: true }, at(-5))).toBe("closed");
    expect(batchPhase({ ...b, isClosed: true }, at(5))).toBe("closed");
  });
  it("accepts the start as an ISO string (straight from the database driver or JSON)", () => {
    expect(batchPhase({ ...b, startsAt: new Date(START).toISOString() }, at(1))).toBe("live");
  });
  it("a zero late-entry time closes right at the start", () => {
    expect(batchPhase({ ...b, lateEntryMin: 0 }, at(0))).toBe("live");
    expect(batchPhase({ ...b, lateEntryMin: 0 }, at(0.01))).toBe("closed");
  });
  it("the interview link outlives the batch", () => {
    expect(interviewExpiry(b, 45).getTime()).toBe(at(15 + 45 + 24 * 60));
  });
});

describe("validateBatchInput", () => {
  const ok = { name: "Campus drive", templateId: "11111111-1111-4111-8111-111111111111", startsAt: new Date(START + 3_600_000).toISOString() };
  it("fills the defaults", () => {
    const r = validateBatchInput(ok, START);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ role: "Software Engineer", opensBeforeMin: 10, lateEntryMin: 15, maxCandidates: null });
  });
  it("rejects a missing name, template, bad time and bad numbers", () => {
    const r = validateBatchInput({ name: " ", templateId: "x", startsAt: "nope", opensBeforeMin: -1, lateEntryMin: 9999, maxCandidates: 0 }, START);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(6);
  });
  it("rejects a start time in the past", () => {
    const r = validateBatchInput({ ...ok, startsAt: new Date(START - 3_600_000).toISOString() }, START);
    expect(r.ok).toBe(false);
  });
});

describe("validateRegistration", () => {
  it("accepts a normal candidate and tidies spaces", () => {
    const r = validateRegistration({ name: "  Asha   Rao ", email: "asha@example.com", phone: "+91 98765-43210" });
    expect(r).toEqual({ ok: true, value: { name: "Asha Rao", email: "asha@example.com", phone: "+91 98765-43210" } });
  });
  it("reports each bad field", () => {
    const r = validateRegistration({ name: "A", email: "nope", phone: "12" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["email", "name", "phone"]);
  });
  it("rejects letters in the phone number", () => {
    const r = validateRegistration({ name: "Asha Rao", email: "a@b.co", phone: "call me maybe" });
    expect(r.ok).toBe(false);
  });
});

describe("public view and helpers", () => {
  const stages = [{ key: "puzzle", budgetMin: 40, graceMin: 2, earlyDoneAfterMin: null, mode: "specific", itemId: "11111111-1111-4111-8111-111111111111", runbookId: null }] as any;
  it("shows labels, not question content", () => {
    const v = publicBatchView({ ...b, name: "Drive", stages }, "Acme", at(-5));
    expect(v).toMatchObject({ name: "Drive", orgName: "Acme", phase: "open", requiresPartA: false, durationMin: 44, stageLabels: ["Reasoning puzzle"] });
    expect(JSON.stringify(v)).not.toContain("itemId");
    expect(v.serverNow).toBe(new Date(at(-5)).toISOString());
  });
  it("flags Part A", () => {
    const v = publicBatchView({ ...b, name: "Drive", stages: [{ ...stages[0], key: "parta", mode: "specific" }] }, "Acme", at(1));
    expect(v.requiresPartA).toBe(true);
  });
  it("reads stored stages and refuses junk", () => {
    expect(readStoredStages(stages)?.length).toBe(1);
    expect(readStoredStages("nope")).toBeNull();
    expect(readStoredStages([])).toBeNull();
  });
  it("makes unguessable, distinct codes", () => {
    const codes = new Set(Array.from({ length: 50 }, newJoinCode));
    expect(codes.size).toBe(50);
    expect(Array.from(codes)[0]).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
  it("formats the countdown", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(61_000)).toBe("01:01");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
    expect(formatCountdown(-5)).toBe("00:00");
  });
});
