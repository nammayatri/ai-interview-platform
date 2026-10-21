// Hidden answer check. Before the interviewer replies, a separate quick model call looks at the candidate's last
// answer and returns a verdict. The verdict is turned into a private instruction for THIS turn only, so the
// interviewer cannot drift into accepting a bare "yes", agreeing with wrong reasoning, or explaining the answer.
// Fails open: any error, timeout or unreadable reply means "no directive" and the turn goes ahead as before.

export type JudgeVerdict = "ok" | "bare_answer" | "wrong_reasoning" | "repeat_request" | "asks_for_answer" | "asks_for_hint";

const VERDICTS: JudgeVerdict[] = ["ok", "bare_answer", "wrong_reasoning", "repeat_request", "asks_for_answer", "asks_for_hint"];

export const JUDGE_INSTRUCTION = `You are a hidden checker for an interview. Do NOT reply to the candidate. Read the interviewer's last question and the candidate's last answer above, then classify the answer. Output ONLY one JSON object: {"verdict":"...","note":"..."}

Verdicts:
- "bare_answer": the interviewer asked for a reason, an explanation or a complexity with why, and the candidate gave only yes/no, a bare number, a bare claim, or "because it is faster" level filler with no real reasoning. Also use it when a claim obviously needs a reason and none was given.
- "wrong_reasoning": the candidate gave a reason or explanation that is factually or logically wrong given the problem and code above. In "note" write one short, concrete counterexample or case that breaks it (do NOT state the correct answer).
- "repeat_request": the candidate asked the interviewer to repeat or rephrase the question.
- "asks_for_answer": the candidate asked the interviewer to tell them the answer, confirm if they are right, or give the solution.
- "asks_for_hint": the candidate asked for a hint, a nudge, help, or said they are stuck and cannot think of anything.
- "ok": anything else (a sound answer, a partial answer with reasoning, "I don't know", asking for a moment to think, a clarifying question about the problem statement).

Be strict about bare answers and wrong reasoning, but never mark "I don't know" or a request for time as a problem. "note" is optional and at most 25 words.`;

export function parseJudgeVerdict(raw: string): { verdict: JudgeVerdict; note: string } | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const verdict = String(o.verdict || "").trim() as JudgeVerdict;
    if (!VERDICTS.includes(verdict)) return null;
    const note = typeof o.note === "string" ? o.note.replace(/\s+/g, " ").trim().slice(0, 240) : "";
    return { verdict, note };
  } catch {
    return null;
  }
}

/** Private instruction for the interviewer's next reply; null when nothing needs enforcing. */
export function directiveFor(v: { verdict: JudgeVerdict; note: string } | null, ctx: { hintUnlocked?: boolean } = {}): string | null {
  if (!v) return null;
  switch (v.verdict) {
    case "bare_answer":
      return "The candidate's last answer gave no real reason. Do NOT accept it, do NOT explain it for them and do NOT move on. Ask once for the reasoning (for example \"Walk me through why.\"). Mark the turn [ASSESS:weak].";
    case "wrong_reasoning":
      return `The candidate's last reasoning is wrong. Do NOT agree, do NOT say it is wrong, do NOT give the correct answer and do NOT move on. Challenge it with a concrete case or small input that breaks it${v.note ? ` (a check found this case: ${v.note})` : ""}, phrased as a question. Mark the turn [ASSESS:weak].`;
    case "repeat_request":
      return "The candidate asked you to repeat the question. Repeat your previous question word for word and add NOTHING: no hint, no explanation, no extra context, no rephrasing. Do not add an [ASSESS] marker for this turn.";
    case "asks_for_answer":
      return "The candidate is asking you for the answer or for confirmation. Do not give it and do not confirm or deny. Say you cannot say whether it is right and ask them to explain how they would check it themselves. Do not add an [ASSESS] marker for this turn.";
    case "asks_for_hint":
      return ctx.hintUnlocked
        ? "The candidate asked for help. A hint is unlocked below: give ONLY that hint, close to as written, add nothing to it (no examples, numbers or extra steps), and append its [HINT:n] marker. Do not add an [ASSESS] marker for this turn."
        : "The candidate asked for a hint, but none is unlocked. Give NO hint and no content, not even a direction or a leading question. Say you would like to hear their thinking first, and ask what they have tried or what they notice. Do not add an [ASSESS] marker for this turn.";
    default:
      return null;
  }
}

/** Adds the directive to the interviewer's system message for this turn only. */
export function withDirective(messages: { role: string; content: string }[], directive: string | null): { role: string; content: string }[] {
  if (!directive || messages.length === 0) return messages;
  const copy = messages.slice();
  const first = copy[0];
  const block = `\n\nPRIVATE CHECK FOR THIS TURN ONLY (never mention it to the candidate, it overrides your usual choice of next question):\n${directive}`;
  if (first.role === "system") copy[0] = { ...first, content: first.content + block };
  else copy.unshift({ role: "system", content: block.trim() });
  return copy;
}
