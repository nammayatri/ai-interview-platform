import { describe, expect, it } from "vitest";
import { summarizeIntegrity } from "../integrity";

describe("summarizeIntegrity", () => {
  it("is empty for no events or other events", () => {
    expect(summarizeIntegrity(undefined).total).toBe(0);
    expect(summarizeIntegrity([{ type: "window_blur" }]).headline).toBe("");
  });
  it("counts each kind and writes a headline", () => {
    const s = summarizeIntegrity([{ type: "screenshot_attempt" }, { type: "screenshot_attempt" }, { type: "copy_attempt" }, { type: "paste_attempt" }, { type: "face_missing" }]);
    expect(s).toMatchObject({ screenshots: 2, copies: 1, pastes: 1, total: 4 });
    expect(s.headline).toBe("Possible plagiarism / content leak: 2 screenshot attempts, 1 attempt to copy interview content, 1 attempt to paste into the code area.");
  });
  it("counts leaving the screen with the time away, and fullscreen exits", () => {
    const s = summarizeIntegrity([
      { type: "left_screen", message: "Left the interview screen for 12 s (switched tab or app)." },
      { type: "left_screen", message: "Left the interview screen for 30 s (switched tab or app)." },
      { type: "fullscreen_exit" },
    ]);
    expect(s).toMatchObject({ leftScreen: 2, awaySeconds: 42, fullscreenExits: 1, total: 3 });
    expect(s.headline).toContain("left the interview screen 2 times (about 42 s away in total)");
    expect(s.headline).toContain("exited fullscreen 1 time");
  });
});
