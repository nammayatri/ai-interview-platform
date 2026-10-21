// Content-integrity events raised by the interview room: trying to screenshot, copy out of, or paste into the
// interview. They are reported to reviewers as possible plagiarism / content leaking.

export const INTEGRITY_TYPES = ["screenshot_attempt", "copy_attempt", "paste_attempt", "left_screen", "fullscreen_exit"] as const;

export interface IntegritySummary {
  screenshots: number;
  copies: number;
  pastes: number;
  leftScreen: number;
  awaySeconds: number;
  fullscreenExits: number;
  total: number;
  /** One line for reviewers and for the scoring prompt; empty when there is nothing to report. */
  headline: string;
}

export function summarizeIntegrity(events: { type: string; message?: string }[] | undefined | null): IntegritySummary {
  const list = events || [];
  const count = (t: string) => list.filter((e) => e.type === t).length;
  const screenshots = count("screenshot_attempt");
  const copies = count("copy_attempt");
  const pastes = count("paste_attempt");
  const away = list.filter((e) => e.type === "left_screen");
  const leftScreen = away.length;
  const awaySeconds = away.reduce((n, e) => n + (parseInt(/for (\d+) s/.exec(e.message || "")?.[1] || "0", 10) || 0), 0);
  const fullscreenExits = count("fullscreen_exit");
  const total = screenshots + copies + pastes + leftScreen + fullscreenExits;
  const parts: string[] = [];
  if (screenshots) parts.push(`${screenshots} screenshot attempt${screenshots > 1 ? "s" : ""}`);
  if (copies) parts.push(`${copies} attempt${copies > 1 ? "s" : ""} to copy interview content`);
  if (pastes) parts.push(`${pastes} attempt${pastes > 1 ? "s" : ""} to paste into the code area`);
  if (leftScreen) parts.push(`left the interview screen ${leftScreen} time${leftScreen > 1 ? "s" : ""}${awaySeconds ? ` (about ${awaySeconds} s away in total)` : ""}`);
  if (fullscreenExits) parts.push(`exited fullscreen ${fullscreenExits} time${fullscreenExits > 1 ? "s" : ""}`);
  const headline = total ? `Possible plagiarism / content leak: ${parts.join(", ")}.` : "";
  return { screenshots, copies, pastes, leftScreen, awaySeconds, fullscreenExits, total, headline };
}
