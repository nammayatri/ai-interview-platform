import { describe, expect, it } from "vitest";
import {
  decideMarkers, nextUnlockedHint, parseMarkers, resolvePhase, sanitizeCandidateText, selectDsaProblem, selectPuzzle, stripMarkers,
} from "../phase-engine";
import type { PoolEntry } from "../runbook";
import { hints, phase, puzzleRunbook } from "./fixtures";

const iv = { startedAt: "2026-01-01T10:00:00.000Z", duration: 30 };
const at = (min: number) => new Date(new Date(iv.startedAt).getTime() + min * 60000);

describe("resolvePhase", () => {
  const phases = [phase()];
  it("does nothing before the budget", () => {
    const r = resolvePhase(phases, iv, at(5));
    expect(r.action).toBe("none");
    expect(r.elapsedInPhaseMin).toBeCloseTo(5);
    expect(r.remainingTotalMin).toBeCloseTo(25);
  });
  it("requests wrap exactly at the budget", () => expect(resolvePhase(phases, iv, at(12)).action).toBe("request_wrap"));
  it("still requests wrap inside the grace window", () => expect(resolvePhase(phases, iv, at(13.9)).action).toBe("request_wrap"));
  it("force-ends at budget plus grace", () => expect(resolvePhase(phases, iv, at(14)).action).toBe("force_end"));
  it("returns no current phase when none is active", () => {
    const r = resolvePhase([phase({ status: "completed" })], iv, at(5));
    expect(r.current).toBeNull();
    expect(r.action).toBe("none");
  });
  it("measures phase time from the phase start, not the interview start", () => {
    const late = [phase({ startedAt: at(10).toISOString() })];
    expect(resolvePhase(late, iv, at(15)).elapsedInPhaseMin).toBeCloseTo(5);
  });
  it("clamps remaining total time at zero", () => expect(resolvePhase(phases, iv, at(45)).remainingTotalMin).toBe(0));
});

describe("nextUnlockedHint", () => {
  it("is locked by the time gate", () => expect(nextUnlockedHint(hints, [], 4, 0)).toBeNull());
  it("unlocks hint 1 after its time gate", () => expect(nextUnlockedHint(hints, [], 5, 0)?.order).toBe(1));
  it("is locked by the weak-answer gate", () => expect(nextUnlockedHint(hints, [1], 20, 1)).toBeNull());
  it("unlocks hint 2 by weak answers alone", () => expect(nextUnlockedHint(hints, [1], 0, 2)?.order).toBe(2));
  it("requires all conditions of one hint (both gates)", () => {
    expect(nextUnlockedHint(hints, [1, 2], 12, 2)).toBeNull();
    expect(nextUnlockedHint(hints, [1, 2], 12, 3)?.order).toBe(3);
  });
  it("never offers hint 2 before hint 1 is used, even when hint 2's own gate is open", () => {
    // hint 2's weak-answer gate is open (5 >= 2) but hint 1 is unused and still time-locked: nothing is offered
    expect(nextUnlockedHint(hints, [], 1, 5)).toBeNull();
  });
  it("returns null when the ladder is exhausted", () => expect(nextUnlockedHint(hints, [1, 2, 3], 99, 99)).toBeNull());
  it("treats a hint with no gates as unlocked from the start", () => {
    expect(nextUnlockedHint([{ order: 1, text: "x", scoreDiscount: 0 }], [], 0, 0)?.order).toBe(1);
  });
});

describe("selectPuzzle", () => {
  const entry = (id: string, min: number): PoolEntry => ({ puzzleId: id, version: 1, title: id, runbook: { ...puzzleRunbook, expectedMin: min } });
  const pool = [entry("a", 4), entry("b", 6), entry("c", 9)];
  it("only picks entries that fit", () => {
    for (let i = 0; i < 20; i++) expect(["a", "b"]).toContain(selectPuzzle(pool, 7, `seed-${i}`)!.puzzleId);
  });
  it("is deterministic for the same seed", () => {
    expect(selectPuzzle(pool, 10, "interview-1")!.puzzleId).toBe(selectPuzzle(pool, 10, "interview-1")!.puzzleId);
  });
  it("different seeds can pick different entries", () => {
    const picks = new Set(Array.from({ length: 40 }, (_, i) => selectPuzzle(pool, 10, `s${i}`)!.puzzleId));
    expect(picks.size).toBeGreaterThan(1);
  });
  it("ordered mode picks the first that fits", () => expect(selectPuzzle(pool, 5, "x", "ordered")!.puzzleId).toBe("a"));
  it("falls back to the shortest within three minutes of the remaining time", () => {
    expect(selectPuzzle(pool, 2, "x")!.puzzleId).toBe("a"); // shortest is 4 min, within 2 + 3
  });
  it("a specific puzzle always runs, even when it does not fit the time", () => {
    expect(selectPuzzle([entry("long", 30)], 2, "x", "specific")!.puzzleId).toBe("long");
  });
  it("returns null when even the shortest is too long", () => expect(selectPuzzle(pool, 0.5, "x")).toBeNull());
  it("returns null for an empty pool", () => expect(selectPuzzle([], 30, "x")).toBeNull());
});

describe("parseMarkers", () => {
  it("parses each marker alone", () => {
    expect(parseMarkers("Okay. [ASSESS:weak]").assess).toBe("weak");
    expect(parseMarkers("Try this. [HINT:2]").hint).toBe(2);
    expect(parseMarkers("Moving on. [PHASE_DONE]").phaseDone).toBe(true);
    expect(parseMarkers("Thanks, goodbye. [END_INTERVIEW]").endInterview).toBe(true);
  });
  it("parses combined markers and strips them all", () => {
    const r = parseMarkers("Let us move on. [ASSESS:on_track] [PHASE_DONE]");
    expect(r).toMatchObject({ assess: "on_track", phaseDone: true, clean: "Let us move on." });
  });
  it("ignores malformed markers but still strips them", () => {
    const r = parseMarkers("Hello [ASSESS:great] there [HINT:abc]");
    expect(r.assess).toBeUndefined();
    expect(r.hint).toBeUndefined();
    expect(r.clean).toBe("Hello there");
  });
  it("handles a marker in the middle of the text", () => {
    expect(parseMarkers("First part [ASSESS:weak] second part.").clean).toBe("First part second part.");
  });
  it("is tolerant of case and spacing", () => {
    expect(parseMarkers("x [assess: Weak ]").assess).toBe("weak");
    expect(parseMarkers("x [ HINT : 3 ]").hint).toBe(3);
  });
  it("leaves text without markers untouched", () => {
    const r = parseMarkers("Plain sentence with arr[i] and a list [1, 2].");
    expect(r.clean).toBe("Plain sentence with arr[i] and a list [1, 2].");
    expect(r).toMatchObject({ phaseDone: false, endInterview: false });
  });
  it("stripMarkers matches parseMarkers().clean", () => {
    expect(stripMarkers("a [PHASE_DONE]")).toBe("a");
  });
});

describe("sanitizeCandidateText", () => {
  it("removes marker-like tokens", () => {
    const out = sanitizeCandidateText("note [PHASE_DONE] and [ASSESS:on_track] [HINT:1] end");
    expect(out).not.toMatch(/PHASE_DONE|ASSESS|HINT/);
    expect(out).toContain("note");
    expect(out).toContain("end");
  });
  it("keeps ordinary brackets", () => {
    expect(sanitizeCandidateText("dp[i] = dp[i-1] + a[N]")).toBe("dp[i] = dp[i-1] + a[N]");
  });
});

describe("decideMarkers", () => {
  const base = { unlockedHintOrder: 1, elapsedInPhaseMin: 3, earlyDoneAfterMin: 6, action: "none" as const, expectAssess: true };
  it("accepts the unlocked hint and rejects any other", () => {
    expect(decideMarkers(parseMarkers("x [HINT:1]"), base)).toMatchObject({ acceptHint: true, hintViolation: false });
    expect(decideMarkers(parseMarkers("x [HINT:3]"), base)).toMatchObject({ acceptHint: false, hintViolation: true });
    expect(decideMarkers(parseMarkers("x [HINT:1]"), { ...base, unlockedHintOrder: null })).toMatchObject({ hintViolation: true });
  });
  it("ignores an early PHASE_DONE", () => {
    expect(decideMarkers(parseMarkers("x [PHASE_DONE]"), base)).toMatchObject({ acceptPhaseDone: false, phaseDoneIgnored: true });
  });
  it("accepts PHASE_DONE after the early threshold or when a wrap was requested", () => {
    expect(decideMarkers(parseMarkers("x [PHASE_DONE]"), { ...base, elapsedInPhaseMin: 6 }).acceptPhaseDone).toBe(true);
    expect(decideMarkers(parseMarkers("x [PHASE_DONE]"), { ...base, action: "request_wrap" }).acceptPhaseDone).toBe(true);
  });
  it("counts weak and off_track answers, flags a missing assessment", () => {
    expect(decideMarkers(parseMarkers("x [ASSESS:weak]"), base).countWeak).toBe(true);
    expect(decideMarkers(parseMarkers("x [ASSESS:off_track]"), base).countWeak).toBe(true);
    expect(decideMarkers(parseMarkers("x [ASSESS:on_track]"), base).countWeak).toBe(false);
    expect(decideMarkers(parseMarkers("x"), base).missingAssess).toBe(true);
    expect(decideMarkers(parseMarkers("x"), { ...base, expectAssess: false }).missingAssess).toBe(false);
  });
});

describe("selectDsaProblem", () => {
  const e = (id: string) => ({ problemId: id, version: 1, title: id, runbook: {} as any });
  const pool = [e("a"), e("b"), e("c"), e("d")];
  it("specific returns the single chosen problem", () => expect(selectDsaProblem([e("only")], "s", "specific")!.problemId).toBe("only"));
  it("random is deterministic per seed and spreads across seeds", () => {
    expect(selectDsaProblem(pool, "i1:dsa", "random")!.problemId).toBe(selectDsaProblem(pool, "i1:dsa", "random")!.problemId);
    expect(new Set(Array.from({ length: 60 }, (_, i) => selectDsaProblem(pool, `s${i}:dsa`, "random")!.problemId)).size).toBeGreaterThan(2);
  });
  it("returns null for an empty pool", () => expect(selectDsaProblem([], "s", "random")).toBeNull());
});
