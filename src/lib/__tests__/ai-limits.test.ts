import { afterEach, describe, expect, it, vi } from "vitest";
import { aiLimits, envInt } from "../ai-limits";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("envInt", () => {
  it("returns the default when unset or blank", () => {
    expect(envInt("NOPE_NOT_SET", 7)).toBe(7);
    vi.stubEnv("X_LIMIT", "  ");
    expect(envInt("X_LIMIT", 7)).toBe(7);
  });
  it("reads a valid integer", () => {
    vi.stubEnv("X_LIMIT", "1234");
    expect(envInt("X_LIMIT", 7)).toBe(1234);
  });
  it("ignores junk, decimals and out-of-range values, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["abc", "12.5", "-3", "0", "99999999"]) {
      vi.stubEnv("X_LIMIT", bad);
      expect(envInt("X_LIMIT", 7, 1, 100000)).toBe(7);
    }
    expect(warn).toHaveBeenCalledTimes(5);
  });
});

describe("aiLimits defaults and overrides", () => {
  it("defaults match what the app used before", () => {
    expect([aiLimits.phaseScoringMaxTokens(), aiLimits.finalScoringMaxTokens(), aiLimits.scoringRetryMaxTokens(), aiLimits.scoringTimeoutMs()]).toEqual([8000, 12000, 16000, 600000]);
    expect([aiLimits.chatMaxTokens(700), aiLimits.chatMaxTokens(500)]).toEqual([700, 500]);
  });
  it("each can be changed from the environment, and is read at call time", () => {
    vi.stubEnv("SUMMARY_AI_PHASE_MAX_TOKENS", "10000");
    vi.stubEnv("SUMMARY_AI_MAX_TOKENS", "20000");
    vi.stubEnv("SUMMARY_AI_RETRY_MAX_TOKENS", "30000");
    vi.stubEnv("SUMMARY_AI_TIMEOUT_MS", "300000");
    vi.stubEnv("AI_CHAT_MAX_TOKENS", "900");
    expect([aiLimits.phaseScoringMaxTokens(), aiLimits.finalScoringMaxTokens(), aiLimits.scoringRetryMaxTokens(), aiLimits.scoringTimeoutMs()]).toEqual([10000, 20000, 30000, 300000]);
    expect([aiLimits.chatMaxTokens(700), aiLimits.chatMaxTokens(500)]).toEqual([900, 900]);
  });
  it("a bad value falls back to the default instead of breaking scoring", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("SUMMARY_AI_PHASE_MAX_TOKENS", "lots");
    expect(aiLimits.phaseScoringMaxTokens()).toBe(8000);
  });
});
