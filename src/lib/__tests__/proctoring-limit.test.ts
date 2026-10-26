import { afterEach, describe, expect, it } from "vitest";
import { maxProctoringStrikes, proctoringEnforced } from "../proctoring-limit";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("proctoring limit", () => {
  it("enforces the configured limit by default", () => {
    delete process.env.PROCTORING_ENFORCE;
    process.env.MAX_PROCTORING_STRIKES = "20";
    expect(proctoringEnforced()).toBe(true);
    expect(maxProctoringStrikes()).toBe(20);
  });
  it("falls back to 25", () => {
    delete process.env.PROCTORING_ENFORCE; delete process.env.MAX_PROCTORING_STRIKES; delete process.env.NEXT_PUBLIC_MAX_PROCTORING_STRIKES;
    expect(maxProctoringStrikes()).toBe(25);
  });
  it("PROCTORING_ENFORCE=false removes the limit whatever the number is", () => {
    process.env.PROCTORING_ENFORCE = "false";
    process.env.MAX_PROCTORING_STRIKES = "20";
    expect(proctoringEnforced()).toBe(false);
    expect(maxProctoringStrikes()).toBe(Number.MAX_SAFE_INTEGER);
    expect(0.25 * 100000 >= maxProctoringStrikes()).toBe(false);
  });
});
