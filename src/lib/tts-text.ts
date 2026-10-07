// Turns an AI reply into text that sounds right when read aloud by a TTS engine.
// The on-screen transcript keeps the original text — only the spoken version is changed.

export function cleanForTTS(text: string): string {
  return text
    // Programming terms that would otherwise lose their symbols ("C++" → "C", "C#" → "C")
    .replace(/\bC\+\+/g, "C plus plus")
    .replace(/\bC#/g, "C sharp")
    .replace(/\bF#/g, "F sharp")
    // Big-O notation: "O(n log n)" → "O of n log n"
    .replace(/\bO\(([^()]*)\)/g, "O of $1")
    // Array indexing: "arr[i]" → "arr of i" (otherwise the brackets are stripped and it reads "arri")
    .replace(/(?<=[\w\]])\[([^\]]*)\]/g, " of $1")
    // Single-letter variable minus a number: "n-1" → "n minus 1" (leaves "COVID-19", "30-minute" alone)
    .replace(/\b([a-z])\s*-\s*(\d+)\b/g, "$1 minus $2")
    // Comparison / logic operators — multi-character first
    .replace(/<=/g, " less than or equal to ")
    .replace(/>=/g, " greater than or equal to ")
    .replace(/!==|!=/g, " not equal to ")
    .replace(/===|==/g, " equals ")
    .replace(/=>|->/g, " maps to ")
    .replace(/&&/g, " and ")
    .replace(/\|\|/g, " or ")
    .replace(/</g, " less than ")
    .replace(/>/g, " greater than ")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/\s&\s/g, " and ")
    .replace(/(\w)\s*\+\s*(\w)/g, "$1 plus $2")
    .replace(/(\w)\s*=\s*(\w)/g, "$1 equals $2")
    // Markdown/code characters that would be spoken literally
    .replace(/[*#_~`|{}[\]\\]/g, "")
    .replace(/\bhttps?:\/\/\S+/g, "")                // URLs
    .replace(/\b[\w.-]+@[\w.-]+\.\w+/g, "")          // emails
    .replace(/(\d+)-(\w+)/g, "$1 $2")                // "30-minute" → "30 minute"
    .replace(/(\w+)-(\w+)/g, "$1 $2")                // "real-time" → "real time"
    .replace(/[()]/g, "")                            // parentheses
    .replace(/[/:;]/g, " ")                          // slashes colons semicolons
    .replace(/\.\.\./g, ".")                         // ellipsis
    .replace(/—|–/g, ", ")                           // em/en dash → comma pause
    .replace(/\n+/g, " ")                            // newlines to space
    // Strip non-English characters — some models leak CJK/Unicode that TTS speaks as a foreign language
    .replace(/[^\x20-\x7EÀ-ɏ]/g, " ")      // keep ASCII + Latin Extended only
    .replace(/\s{2,}/g, " ")                         // collapse spaces
    .trim();
}
