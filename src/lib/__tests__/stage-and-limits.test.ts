import { describe, expect, it } from "vitest";
import { parseMarkers, stripMarkers } from "../phase-engine";
import { isTransientAIError } from "../ai";
import { aiTurnAllowed } from "../rate-limit";

describe("STAGE marker", () => {
  it("is read and removed from the spoken text", () => {
    const m = parseMarkers("Now the poison kills in exactly 24 hours and you have 48 hours. [STAGE:2] [ASSESS:on_track]");
    expect(m.stage).toBe("2");
    expect(m.assess).toBe("on_track");
    expect(m.clean).toBe("Now the poison kills in exactly 24 hours and you have 48 hours.");
  });
  it("accepts a lettered or word label and ignores junk", () => {
    expect(parseMarkers("x [STAGE:1B]").stage).toBe("1B");
    expect(parseMarkers("x [STAGE: BONUS ]").stage).toBe("BONUS");
    expect(parseMarkers("x [STAGE:]").stage).toBeUndefined();
    expect(parseMarkers("no marker").stage).toBeUndefined();
  });
  it("is stripped per sentence while streaming", () => {
    expect(stripMarkers("Stage three. [STAGE:3]")).toBe("Stage three.");
  });
});

describe("transient AI errors", () => {
  it("retries rate limits, gateway errors and dropped connections", () => {
    for (const m of ["AI API error: 429 slow down", "AI API error: 503 unavailable", "AI API error: 502 bad gateway", "AI API error: 403 <!doctype html><title>403</title>", "fetch failed", "The operation was aborted", "read ECONNRESET"]) {
      expect(isTransientAIError(m)).toBe(true);
    }
  });
  it("does not retry a real client error", () => {
    for (const m of ["AI API error: 400 bad request", "AI API error: 401 invalid key", "AI API error: 403 {\"error\":\"forbidden\"}", "The scoring model did not return usable JSON"]) {
      expect(isTransientAIError(m)).toBe(false);
    }
  });
});

describe("AI turn rate limit", () => {
  it("is per interview, so many candidates behind one IP do not block each other", () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 40; i++) expect(aiTurnAllowed(ip, "interview-a")).toBe(true);
    expect(aiTurnAllowed(ip, "interview-a")).toBe(false);
    for (let c = 0; c < 20; c++) expect(aiTurnAllowed(ip, `interview-other-${c}`)).toBe(true);
  });
});
