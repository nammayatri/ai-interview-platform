import { describe, expect, it } from "vitest";
import { guardReply, guardSentence, lockedPhrases, phrasePattern, withLockedPhrases } from "../reveal-guard";

const NO_REVEAL = ["binary", "base 3", "grid", "10 testers", "7 testers", "patterns", "2^"];

describe("lockedPhrases", () => {
  it("locks every phrase the candidate has not said", () => {
    expect(lockedPhrases(NO_REVEAL, ["I would test one bottle each"])).toEqual(NO_REVEAL);
  });
  it("unlocks a phrase once the candidate says it, in any case or plural", () => {
    const l = lockedPhrases(NO_REVEAL, ["maybe BINARY works", "I think 10 testers are needed", "many pattern"]);
    expect(l).not.toContain("binary");
    expect(l).not.toContain("10 testers");
    expect(l).not.toContain("patterns");
    expect(l).toContain("grid");
  });
  it("returns nothing for a puzzle without a list", () => {
    expect(lockedPhrases(undefined, ["x"])).toEqual([]);
    expect(lockedPhrases([], ["x"])).toEqual([]);
  });
  it("does not match inside a longer word", () => {
    expect(phrasePattern("grid")!.test("the gridlock")).toBe(false);
    expect(phrasePattern("grid")!.test("a grid of bottles")).toBe(true);
    expect(phrasePattern("2^")!.test("2^10 is 1024")).toBe(true);
  });
});

describe("guardSentence", () => {
  const ctx = { locked: NO_REVEAL };
  it("drops a sentence that says a locked phrase", () => {
    expect(guardSentence("Would 10 testers work for 1,024 bottles?", ctx)).toBeNull();
    expect(guardSentence("Think of each bottle's binary number.", ctx)).toBeNull();
  });
  it("keeps a sentence that only uses other words", () => {
    expect(guardSentence("What can happen to one tester at the end?", ctx)).toBe("What can happen to one tester at the end?");
  });
  it("allows a phrase the candidate already unlocked", () => {
    expect(guardSentence("You said binary, so how do you decode the dead testers?", { locked: ["grid"] })).toBe("You said binary, so how do you decode the dead testers?");
  });
  it("cuts a confirming opener but keeps the question", () => {
    expect(guardSentence("Good, now walk me through why that holds for every bottle?", { locked: [] })).toBe("Now walk me through why that holds for every bottle?");
    expect(guardSentence("That's right, so what happens when a tester dies early in round one?", { locked: [] })).toBe("So what happens when a tester dies early in round one?");
  });
  it("drops a bare confirmation", () => {
    for (const s of ["Exactly.", "That's right.", "Good.", "Correct!", "You're right.", "Great job."]) expect(guardSentence(s, { locked: [] })).toBeNull();
  });
  it("does not touch a statement that happens to start with one of those words", () => {
    expect(guardSentence("Exactly one of them is poisoned and it looks normal.", { locked: [] })).toBe("Exactly one of them is poisoned and it looks normal.");
    expect(guardSentence("Right now, what does each tester drink?", { locked: [] })).toBe("Right now, what does each tester drink?");
    expect(guardSentence("Good luck with the next part of the puzzle today.", { locked: [] })).toBe("Good luck with the next part of the puzzle today.");
  });
  it("leaves ordinary uses of those words alone", () => {
    expect(guardSentence("Is this correct for an empty list?", { locked: [] })).toBe("Is this correct for an empty list?");
  });
});

describe("guardReply", () => {
  it("removes only the offending sentences", () => {
    const r = guardReply("Okay. Would 10 testers work? Walk me through how you got your number.", { locked: NO_REVEAL });
    expect(r.changed).toBe(true);
    expect(r.text).toBe("Okay. Walk me through how you got your number.");
  });
  it("falls back to a neutral line when everything is cut", () => {
    const r = guardReply("Exactly right. Binary it is.", { locked: NO_REVEAL });
    expect(r.text).toBe("Okay. Walk me through your thinking.");
  });
  it("returns the reply untouched when it is clean", () => {
    const text = "Walk me through how you got that number.";
    expect(guardReply(text, { locked: NO_REVEAL })).toEqual({ text, changed: false });
  });
});

describe("withLockedPhrases", () => {
  it("adds the block to the system message only when something is locked", () => {
    const msgs = [{ role: "system", content: "base" }, { role: "user", content: "hi" }];
    expect(withLockedPhrases(msgs, [])).toBe(msgs);
    const out = withLockedPhrases(msgs, ["binary"]);
    expect(out[0].content).toContain("\"binary\"");
    expect(out[1]).toEqual(msgs[1]);
    expect(msgs[0].content).toBe("base");
  });
});
