// Answer-leak guard for the DSA Review round. The prompt already tells the interviewer never to give the answer or
// confirm one, but a model still slips: it names the key idea ("binary", "10 testers") before the candidate does, or
// says "exactly right". This is the code-level backstop. It works on what the model actually wrote:
//   - a puzzle can list phrases the interviewer must not say until the candidate has said them (noReveal);
//   - confirming openers ("Exactly.", "That's right.", "Good.") are never allowed.
// A violating sentence is cut (or, for a confirming opener, the opener is cut) before the candidate sees or hears it.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One phrase as a case-insensitive pattern; a plural "s" is allowed and the phrase may not sit inside a longer word. */
export function phrasePattern(phrase: string): RegExp | null {
  let p = phrase.trim().replace(/\s+/g, " ");
  if (!p || p.length > 80) return null;
  // "patterns" and "pattern" are the same word for this purpose
  if (/[a-z]{3,}s$/i.test(p)) p = p.slice(0, -1);
  const body = escapeRe(p).replace(/ /g, "\\s+");
  const endsInWord = /\w$/.test(p);
  return new RegExp(`(?<![\\w])${body}${endsInWord ? "(?:s|es)?(?![\\w])" : ""}`, "i");
}

/** The phrases the interviewer still may not say: those the candidate has not used themselves in this phase. */
export function lockedPhrases(noReveal: string[] | undefined, candidateTexts: string[]): string[] {
  if (!noReveal || noReveal.length === 0) return [];
  const said = candidateTexts.join("\n");
  const out: string[] = [];
  for (const phrase of noReveal) {
    const re = phrasePattern(phrase);
    if (re && !re.test(said)) out.push(phrase.trim());
  }
  return out;
}

// Openers that confirm or praise an answer. Anchored at the start of a sentence so ordinary uses ("is this correct for
// n = 0?") are untouched.
const CONFIRM_OPENER = new RegExp(
  "^\\s*(?:" +
    // "That's right", "You're correct", "That's the right idea", "It's exactly right" ...
    "(?:that'?s|that is|this is|it'?s|you'?re|you are)\\s+(?:absolutely\\s+|exactly\\s+|quite\\s+|totally\\s+)?(?:right|correct|it|exactly|the right (?:idea|track|answer|approach)|on the right track)" +
    // praise phrases
    "|(?:good|great|nice|excellent|fantastic|wonderful|brilliant|sharp|smart) (?:question|point|job|work|idea|thinking|catch|answer|observation|reasoning|insight)" +
    "|exactly right|perfectly right|well done|spot on|good job|nice one" +
    // a bare verdict word, only when it stands alone before punctuation ("Exactly." / "Good, now ..."); "Exactly one bottle" is not one
    "|(?:exactly|precisely|correct|right|absolutely|perfect|excellent|great|good|nice|brilliant|awesome|wonderful|fantastic|yes|yep|yeah|bingo)(?=\\s*[,.!;:—–-])" +
  ")[\\s,.!;:—–-]*",
  "i"
);

const MIN_WORDS_AFTER_OPENER = 4;

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export interface GuardContext {
  /** Phrases still locked (see lockedPhrases). */
  locked: string[];
}

/** Returns the sentence to show, or null when it must be dropped. */
export function guardSentence(sentence: string, ctx: GuardContext): string | null {
  let text = sentence.trim();
  if (!text) return null;

  const opener = CONFIRM_OPENER.exec(text);
  if (opener) {
    const rest = text.slice(opener[0].length).trim();
    // "Good." / "Exactly right." alone say nothing else; "Good, now why does that hold?" keeps its question.
    if (wordCount(rest) < MIN_WORDS_AFTER_OPENER) return null;
    text = capitalise(rest);
  }

  for (const phrase of ctx.locked) {
    const re = phrasePattern(phrase);
    if (re && re.test(text)) return null;
  }
  return text;
}

/** Splits spoken prose into sentences (end punctuation followed by a space). */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

export const NEUTRAL_FALLBACK = "Okay. Walk me through your thinking.";

/** Applies the guard to a whole reply. An empty result becomes a neutral prompt so the candidate is never left without a reply. */
export function guardReply(text: string, ctx: GuardContext): { text: string; changed: boolean } {
  const kept = splitSentences(text)
    .map((s) => guardSentence(s, ctx))
    .filter((s): s is string => s !== null);
  const out = kept.join(" ").trim();
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const changed = norm(out) !== norm(text);
  return { text: out || (changed ? NEUTRAL_FALLBACK : text), changed };
}

/** Private block for the system prompt: names the phrases this turn may not use. */
export function lockedPhrasesBlock(locked: string[]): string {
  if (locked.length === 0) return "";
  return `\n\nWORDS YOU MAY NOT SAY YET (the candidate has not said them; using any of them gives the answer away, and your reply is cut if it does): ${locked.map((p) => `"${p}"`).join(", ")}. Ask open questions in other words; react only to what the candidate has actually said.`;
}

/** Adds the locked-phrase block to the interviewer's system message for this turn. */
export function withLockedPhrases(messages: { role: string; content: string }[], locked: string[]): { role: string; content: string }[] {
  const block = lockedPhrasesBlock(locked);
  if (!block || messages.length === 0) return messages;
  const copy = messages.slice();
  const first = copy[0];
  if (first.role === "system") copy[0] = { ...first, content: first.content + block };
  else copy.unshift({ role: "system", content: block.trim() });
  return copy;
}
