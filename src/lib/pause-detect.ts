// Detects when a candidate is asking for time rather than answering
// ("give me a minute", "let me think", "hold on"...). Only short utterances count, so a real
// answer that happens to contain "let me think" is never treated as a pause request.

const PAUSE_PATTERNS: RegExp[] = [
  /\b(give|gimme|allow|let) me (a |one |some |just a )?(moment|minute|second|sec|min|bit|while|time)\b/i,
  /\b(let me|lemme|allow me to) (think|check|gather|recall|figure|collect|consider|reflect)\b/i,
  /\b(hold on|hang on|wait a|wait one|one moment|one sec|one second|one minute|just a (moment|minute|second|sec)|bear with me|just a min)\b/i,
  /\b(need|want) (a |some |more )?(moment|minute|second|sec|time|bit)\b/i,
  /\b(can i|could i|may i) (have |take |get )?(a |some )?(moment|minute|second|sec|time|pause)\b/i,
  /\b(pause|not ready|think about (it|this)|thinking)\b/i,
];

const MAX_WORDS_FOR_PAUSE = 14;

export function isPauseRequest(text: string): boolean {
  const cleaned = (text || "").trim();
  if (!cleaned) return false;
  const words = cleaned.split(/\s+/).length;
  if (words > MAX_WORDS_FOR_PAUSE) return false;
  return PAUSE_PATTERNS.some((p) => p.test(cleaned));
}

/** How long (ms) after a pause request we stop nudging the candidate. */
export const PAUSE_GRACE_MS = 120_000;
