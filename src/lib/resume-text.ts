// Reads a candidate's resume file (PDF, DOCX or TXT) into text for the interviewer prompt.
import mammoth from "mammoth";
import { stripNul } from "./text-clean";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
const ALLOWED_EXTENSIONS = ["pdf", "docx", "txt"];
const UNREADABLE = "Resume provided but could not be parsed. Proceed with general interview questions.";

async function pdfText(buffer: Buffer): Promise<string> {
  try {
    // lib/pdf-parse.js directly: the package index runs a debug read of a test file on require()
    const pdfParse = require("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    return data.text?.trim() || UNREADABLE;
  } catch (err) {
    console.error("PDF parse failed:", err);
    return UNREADABLE;
  }
}

/** Throws an Error with a message that is safe to show the candidate when the file is not acceptable. */
export async function readResume(file: File): Promise<{ text: string; fileName: string }> {
  if (file.size > MAX_RESUME_BYTES) throw new Error("Resume file too large. Maximum size is 10MB.");
  const ext = file.name.toLowerCase().split(".").pop() || "";
  if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) throw new Error("Invalid file type. Supported: PDF, DOCX, TXT.");
  const buffer = Buffer.from(await file.arrayBuffer());
  let text: string;
  if (ext === "pdf") text = await pdfText(buffer);
  else if (ext === "docx") {
    try {
      text = (await mammoth.extractRawText({ buffer })).value || UNREADABLE;
    } catch {
      text = UNREADABLE;
    }
  } else text = buffer.toString("utf-8");
  // A resume longer than this adds cost to every turn and nothing the interviewer can use.
  return { text: stripNul(text).slice(0, 20_000), fileName: stripNul(file.name).slice(0, 255) };
}
