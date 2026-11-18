import { describe, expect, it, vi } from "vitest";
import { buildInterviewProgress, stageStartTimes, type ProgressInput } from "../interview-progress";

const NOW = new Date("2026-11-16T10:30:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();
const T = (hhmm: string) => `2026-11-16T${hhmm}:00.000Z`;

function phase(phaseKey: "parta" | "dsa" | "puzzle", sequence: number, status: string, startedAt: string | null = null) {
  return { phaseKey, sequence, status, startedAt } as ProgressInput["phases"][number];
}

function input(over: Partial<ProgressInput> = {}): ProgressInput {
  return {
    roundType: "DSA Review",
    status: "in_progress",
    lastHeartbeatAt: ago(5),
    phases: [phase("parta", 1, "completed", T("10:02")), phase("dsa", 2, "active", T("10:25")), phase("puzzle", 3, "pending")],
    stageProgress: null,
    stageStarts: null,
    ...over,
  };
}

const shown = (i: ProgressInput) => {
  const p = buildInterviewProgress(i, NOW);
  if (!p.show) throw new Error("expected the card to show");
  return p;
};

describe("current stage card: when it shows", () => {
  it("is hidden for interviews that are not Coding Evaluation, or have no parts", () => {
    expect(buildInterviewProgress(input({ roundType: "Technical" }), NOW)).toEqual({ show: false });
    expect(buildInterviewProgress(input({ phases: [] }), NOW)).toEqual({ show: false });
  });
});

describe("current stage card: overall state", () => {
  it("not started: every part not reached, no times, no 'now'", () => {
    const p = shown(input({ status: "waiting", phases: [phase("parta", 1, "pending"), phase("puzzle", 2, "pending")] }));
    expect(p.state).toBe("not_started");
    expect(p.now).toBeNull();
    expect(p.parts.map((x) => [x.label, x.status, x.startedAt])).toEqual([["Part A", "pending", null], ["Puzzle", "pending", null]]);
  });
  it("running: the active part is current and named in 'now', with start times", () => {
    const p = shown(input());
    expect(p.state).toBe("running");
    expect(p.now).toBe("DSA");
    expect(p.parts.map((x) => [x.key, x.status, x.startedAt])).toEqual([["parta", "done", T("10:02")], ["dsa", "current", T("10:25")], ["puzzle", "pending", null]]);
  });
  it("running with no active part says 'Wrapping up'", () => {
    const p = shown(input({ phases: [phase("puzzle", 1, "completed", T("10:00"))] }));
    expect(p.now).toBe("Wrapping up");
  });
  it("completed, whatever the reason: just 'completed', no 'now' and no offline warning", () => {
    const p = shown(input({ status: "completed", lastHeartbeatAt: ago(3600), phases: [phase("parta", 1, "completed", T("10:02")), phase("dsa", 2, "skipped"), phase("puzzle", 3, "completed", T("10:31"))] }));
    expect(p.state).toBe("completed");
    expect(p.now).toBeNull();
    expect(p.offlineSeconds).toBeNull();
    expect(p.parts.map((x) => x.status)).toEqual(["done", "skipped", "done"]);
  });
  it("shows only the parts the interview has (puzzle-only)", () => {
    const p = shown(input({ phases: [phase("puzzle", 1, "active", T("11:04"))] }));
    expect(p.parts.map((x) => x.label)).toEqual(["Puzzle"]);
    expect(p.now).toBe("Puzzle");
  });
});

describe("current stage card: puzzle stages", () => {
  const stageProgress = { labels: ["1", "2", "3"], current: 1, completed: 1 };
  it("names the stage in 'now' and carries the boxes with each stage's start time", () => {
    const p = shown(input({ phases: [phase("puzzle", 1, "active", T("10:48"))], stageProgress, stageStarts: [T("10:48"), T("10:55"), null] }));
    expect(p.now).toBe("Puzzle · Stage 2 of 3");
    expect(p.puzzleStages).toEqual({ ...stageProgress, startedAt: [T("10:48"), T("10:55"), null] });
  });
  it("uses the label when it is not just the number", () => {
    const p = shown(input({ phases: [phase("puzzle", 1, "active", T("10:48"))], stageProgress: { labels: ["1", "1B", "2"], current: 1, completed: 1 } }));
    expect(p.now).toBe("Puzzle · Stage 1B (2 of 3)");
  });
  it("has no boxes for a puzzle without a stage list (older interviews)", () => {
    const p = shown(input({ phases: [phase("puzzle", 1, "active", T("10:48"))] }));
    expect(p.puzzleStages).toBeNull();
    expect(p.now).toBe("Puzzle");
  });
  it("stage 1 starts with the puzzle, later stages at their first accepted move", () => {
    const starts = stageStartTimes(["1", "2", "3"], T("10:48"), [
      { label: "2", at: T("10:55") },
      { label: "2", at: T("10:56") }, // a repeat does not move the start
      { label: "unknown", at: T("10:57") },
    ]);
    expect(starts).toEqual([T("10:48"), T("10:55"), null]);
  });
});

describe("current stage card: offline", () => {
  it("is offline after more than 60 seconds without a heartbeat while running", () => {
    expect(shown(input({ lastHeartbeatAt: ago(61) })).offlineSeconds).toBe(61);
    expect(shown(input({ lastHeartbeatAt: ago(59) })).offlineSeconds).toBeNull();
    expect(shown(input({ lastHeartbeatAt: null })).offlineSeconds).toBeNull();
  });
  it("is never offline before the interview starts", () => {
    expect(shown(input({ status: "waiting", lastHeartbeatAt: ago(600) })).offlineSeconds).toBeNull();
  });
});

describe("current stage card: who can read it", () => {
  it("refuses a request without a staff login (a candidate's link has no session)", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));
    const load = vi.fn();
    vi.doMock("@/lib/interview-progress", () => ({ loadInterviewProgress: load }));
    const { GET } = await import("@/app/api/interview/[id]/progress/route");
    const res = await GET(new Request("http://x/api/interview/i-1/progress?token=candidate-token"), { params: Promise.resolve({ id: "i-1" }) });
    expect(res.status).toBe(401);
    expect(load).not.toHaveBeenCalled();
    vi.doUnmock("next-auth");
    vi.doUnmock("@/lib/auth");
    vi.doUnmock("@/lib/interview-progress");
  });
  it("returns 404 for an interview outside the caller's organisation", async () => {
    vi.resetModules();
    vi.doMock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "u", orgId: "org-a", role: "member" } })) }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));
    vi.doMock("@/lib/interview-progress", () => ({ loadInterviewProgress: vi.fn(async () => null) }));
    const { GET } = await import("@/app/api/interview/[id]/progress/route");
    const res = await GET(new Request("http://x/api/interview/i-1/progress"), { params: Promise.resolve({ id: "i-1" }) });
    expect(res.status).toBe(404);
    vi.doUnmock("next-auth");
    vi.doUnmock("@/lib/auth");
    vi.doUnmock("@/lib/interview-progress");
  });
});
