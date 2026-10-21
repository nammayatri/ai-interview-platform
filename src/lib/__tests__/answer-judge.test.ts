import { describe, expect, it } from "vitest";
import { directiveFor, parseJudgeVerdict, withDirective } from "../answer-judge";

describe("parseJudgeVerdict", () => {
  it("reads a clean verdict", () => {
    expect(parseJudgeVerdict('{"verdict":"bare_answer","note":""}')).toEqual({ verdict: "bare_answer", note: "" });
  });
  it("finds JSON inside extra text and trims the note", () => {
    const v = parseJudgeVerdict('Sure.\n```json\n{"verdict":"wrong_reasoning","note":"  a chain   of one child "}\n```');
    expect(v).toEqual({ verdict: "wrong_reasoning", note: "a chain of one child" });
  });
  it("rejects unknown verdicts and garbage", () => {
    expect(parseJudgeVerdict('{"verdict":"great"}')).toBeNull();
    expect(parseJudgeVerdict("not json")).toBeNull();
    expect(parseJudgeVerdict("")).toBeNull();
  });
});

describe("directiveFor", () => {
  it("is silent for ok and unreadable", () => {
    expect(directiveFor({ verdict: "ok", note: "" })).toBeNull();
    expect(directiveFor(null)).toBeNull();
  });
  it("tells the interviewer not to explain on a bare answer", () => {
    expect(directiveFor({ verdict: "bare_answer", note: "" })).toMatch(/do NOT explain/i);
  });
  it("passes the counterexample for wrong reasoning but never asks to state the answer", () => {
    const d = directiveFor({ verdict: "wrong_reasoning", note: "a tree where every node has one child" })!;
    expect(d).toContain("every node has one child");
    expect(d).toMatch(/do NOT give the correct answer/i);
  });
  it("makes repeat verbatim", () => {
    expect(directiveFor({ verdict: "repeat_request", note: "" })).toMatch(/word for word/);
  });
});

describe("withDirective", () => {
  const msgs = [{ role: "system", content: "SYS" }, { role: "user", content: "hi" }];
  it("returns the same messages when there is no directive", () => {
    expect(withDirective(msgs, null)).toBe(msgs);
  });
  it("appends to the system message without mutating the input", () => {
    const out = withDirective(msgs, "DO X");
    expect(out[0].content).toContain("SYS");
    expect(out[0].content).toContain("DO X");
    expect(msgs[0].content).toBe("SYS");
    expect(out[1]).toEqual(msgs[1]);
  });
});
