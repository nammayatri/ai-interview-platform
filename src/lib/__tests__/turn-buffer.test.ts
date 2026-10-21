import { describe, it, expect, vi } from "vitest";
import { TurnBuffer } from "../turn-buffer";

function make(manual = false) {
  const sent: string[] = [];
  const tb = new TurnBuffer({ getDelayMs: () => 3000, isManual: () => manual, canFlush: () => true, onFlush: (t) => sent.push(t) });
  return { tb, sent };
}

describe("TurnBuffer", () => {
  it("exposes what has been finalized so far, so the UI can keep showing it across pauses", () => {
    vi.useFakeTimers();
    const { tb } = make();
    tb.addFinal("the answer is ten");
    tb.addFinal("because two to the power");
    expect(tb.getBuffer()).toBe("the answer is ten because two to the power");
    vi.useRealTimers();
  });

  it("sends after the silence delay in auto mode, and never on its own in manual mode", () => {
    vi.useFakeTimers();
    const auto = make(false);
    auto.tb.addFinal("ten");
    vi.advanceTimersByTime(3100);
    expect(auto.sent).toEqual(["ten"]);
    expect(auto.tb.getBuffer()).toBe("");
    const manual = make(true);
    manual.tb.addFinal("ten");
    vi.advanceTimersByTime(60000);
    expect(manual.sent).toEqual([]);
    manual.tb.submitNow();
    expect(manual.sent).toEqual(["ten"]);
    vi.useRealTimers();
  });
});
