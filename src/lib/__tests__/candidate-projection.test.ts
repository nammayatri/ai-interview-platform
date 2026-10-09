import { describe, expect, it } from "vitest";
import { projectInterviewForCandidate } from "../candidate-projection";
import { customFlow, dsaConfig, partaConfig, phase, puzzleConfig, submissions } from "./fixtures";

const DENYLIST = ["flow", "instructions", "solutionTracks", "hintLadder", "acceptedAnswers", "rubric", "outcomeProbes", "pool", "hintsUsed", "weakAnswers", "scorecard", "config"];
const SECRETS = ["CUSTOM-STEP", "CUSTOM-PROBE", "SECRET-DSA-TRACK", "DSA-HINT-ONE", "DSA-RUBRIC", "SECRET-TRACK-HASHMAP", "SECRET-RUBRIC", "SECRET-ANSWER", "HINT-ONE-TEXT", "HINT-TWO-TEXT", "PASSED-PROBE", "PARTIAL-PROBE", "CONTEXT-CODE-SHOULD-NOT-APPEAR"];

const interview = (phases: any[]) => ({
  roundType: "DSA Review",
  phases,
  submissions,
  resume: "r",
});

describe("candidate projection", () => {
  it("never exposes runbook internals while the DSA phase is active", () => {
    const out = JSON.stringify(projectInterviewForCandidate(interview([phase(), phase({ id: "p2", phaseKey: "puzzle", sequence: 2, status: "pending", config: { ...puzzleConfig, selected: undefined } })])));
    DENYLIST.forEach((k) => expect(out).not.toContain(`"${k}"`));
    SECRETS.forEach((s) => expect(out).not.toContain(s));
    expect(out).toContain("Two Sum");
    expect(out).toContain("def f(a, t)");
  });

  it("exposes only the title and statement of the active puzzle", () => {
    const out = JSON.stringify(projectInterviewForCandidate(interview([
      phase({ status: "completed" }),
      phase({ id: "p2", phaseKey: "puzzle", sequence: 2, status: "active", config: puzzleConfig }),
    ])));
    DENYLIST.forEach((k) => expect(out).not.toContain(`"${k}"`));
    SECRETS.forEach((s) => expect(out).not.toContain(s));
    expect(out).toContain("PUZZLE-STATEMENT");
  });

  it("does not expose a puzzle that has not been activated", () => {
    const out = JSON.stringify(projectInterviewForCandidate(interview([phase({ id: "p2", phaseKey: "puzzle", sequence: 2, status: "pending", config: puzzleConfig })])));
    expect(out).not.toContain("PUZZLE-STATEMENT");
  });

  it("only returns the primary submission", () => {
    const out = projectInterviewForCandidate(interview([phase()]));
    expect(out.submissions).toHaveLength(1);
    expect((out.submissions as any)[0].isPrimary).toBe(true);
  });

  it("leaves other round types untouched", () => {
    const other = { roundType: "Technical", resume: "r" };
    expect(projectInterviewForCandidate(other)).toBe(other);
  });

  it("keeps the Part A config (and the runbook flow) out of the projected phase", () => {
    const p = (projectInterviewForCandidate(interview([phase({ config: { ...partaConfig, flow: customFlow } })])).phases as any)[0];
    expect(Object.keys(p).sort()).toEqual(["budgetMin", "endedAt", "phaseKey", "problemTitle", "runbook", "startedAt", "status"]);
    expect(Object.keys(p.runbook)).toEqual(["statementMd"]);
  });

  it("reveals a DSA stage's problem only once it is active", () => {
    const dsa = (status: string) => phase({ id: "d", phaseKey: "dsa", sequence: 2, status: status as any, config: dsaConfig });
    const pending = JSON.stringify(projectInterviewForCandidate(interview([phase({ status: "completed" }), dsa("pending")])));
    expect(pending).not.toContain("DSA-STATEMENT");
    const active = JSON.stringify(projectInterviewForCandidate(interview([phase({ status: "completed" }), dsa("active")])));
    expect(active).toContain("DSA-STATEMENT");
    DENYLIST.forEach((k) => expect(active).not.toContain(`"${k}"`));
    SECRETS.forEach((x) => expect(active).not.toContain(x));
  });

  it("does not leak the other problems of a random DSA pool", () => {
    const pooled = { ...dsaConfig, pool: [...dsaConfig.pool, { problemId: "d-2", version: 1, title: "OTHER-POOL-PROBLEM", runbook: dsaConfig.pool[0].runbook }] };
    const out = JSON.stringify(projectInterviewForCandidate(interview([phase({ id: "d", phaseKey: "dsa", config: pooled as any })])));
    expect(out).not.toContain("OTHER-POOL-PROBLEM");
  });
});
