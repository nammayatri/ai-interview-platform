import { describe, expect, it } from "vitest";
import { defaultBatchSettings, disabledEventTypes, effectiveMaxStrikes, eventEnabled, normalizeBatchSettings, validateBatchSettings } from "../batch-settings";
import { fromHundred, passVerdict, toHundred } from "../score-scale";

describe("score scale", () => {
  it("maps 1..5 to 0..100", () => {
    expect([1, 2, 3, 4, 5].map(toHundred)).toEqual([0, 25, 50, 75, 100]);
    expect(toHundred(3.3)).toBe(58);
    expect(toHundred(null)).toBeNull();
    expect(toHundred(9)).toBe(100);
    expect(toHundred(0)).toBe(0);
  });
  it("round trips", () => { expect(fromHundred(50)).toBe(3); expect(fromHundred(100)).toBe(5); });
  it("pass or fail against the mark, and null when unscored", () => {
    expect(passVerdict(3.0, 50)).toBe("pass");
    expect(passVerdict(2.9, 50)).toBe("fail");
    expect(passVerdict(4.0, 80)).toBe("fail");
    expect(passVerdict(null, 50)).toBeNull();
  });
});

describe("batch settings", () => {
  const env = {};
  it("defaults follow the environment", () => {
    const d = defaultBatchSettings({ PROCTORING_ENFORCE: "false", MAX_PROCTORING_STRIKES: "10000", ALLOW_MEDIA_TOGGLE: "false" });
    expect(d.proctoring.enforce).toBe(false);
    expect(d.proctoring.maxStrikes).toBe(10000);
    expect(d.proctoring.allowMediaToggle).toBe(false);
    expect(defaultBatchSettings({}).proctoring.maxStrikes).toBe(25);
    expect(defaultBatchSettings({}).passMark).toBe(50);
  });
  it("an empty or broken value falls back to the defaults", () => {
    for (const raw of [undefined, null, {}, "x", [], { proctoring: "x" }, { passMark: "abc", proctoring: { maxStrikes: -3, checks: 5 } }]) {
      expect(normalizeBatchSettings(raw, env)).toEqual(defaultBatchSettings(env));
    }
  });
  it("stored values override the environment", () => {
    const s = normalizeBatchSettings({ passMark: 65, proctoring: { enforce: false, maxStrikes: 40, checks: { cameraOff: false } } }, { MAX_PROCTORING_STRIKES: "20" });
    expect(s.passMark).toBe(65);
    expect(s.proctoring.enforce).toBe(false);
    expect(s.proctoring.maxStrikes).toBe(40);
    expect(s.proctoring.checks.cameraOff).toBe(false);
    expect(s.proctoring.checks.faceMissing).toBe(true);
  });
  it("switched-off checks disable their events", () => {
    const s = normalizeBatchSettings({ proctoring: { checks: { copyPaste: false, tabSwitch: false } } }, env);
    expect(disabledEventTypes(s).sort()).toEqual(["copy_attempt", "left_screen", "paste_attempt", "window_blur"]);
    expect(eventEnabled(s, "copy_attempt")).toBe(false);
    expect(eventEnabled(s, "face_missing")).toBe(true);
    expect(eventEnabled(s, "heartbeat_missing")).toBe(true);
  });
  it("no limit when enforcement is off", () => {
    expect(effectiveMaxStrikes(normalizeBatchSettings({ proctoring: { enforce: false } }, env))).toBe(Number.MAX_SAFE_INTEGER);
    expect(effectiveMaxStrikes(normalizeBatchSettings({ proctoring: { maxStrikes: 12 } }, env))).toBe(12);
  });
  it("validates admin input strictly", () => {
    expect(validateBatchSettings({ passMark: 101 }, env).ok).toBe(false);
    expect(validateBatchSettings({ proctoring: { maxStrikes: 0 } }, env).ok).toBe(false);
    expect(validateBatchSettings({ proctoring: { maxStrikes: 2.5 } }, env).ok).toBe(false);
    expect(validateBatchSettings({ proctoring: { checks: { nope: true } } }, env).ok).toBe(false);
    expect(validateBatchSettings({ proctoring: { enforce: "yes" } }, env).ok).toBe(false);
    const ok = validateBatchSettings({ passMark: 70, proctoring: { maxStrikes: 50, checks: { screenshot: false } } }, env);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.proctoring.checks.screenshot).toBe(false);
  });
});
