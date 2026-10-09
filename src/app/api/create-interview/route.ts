import { NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";
import { saveInterview, Interview } from "@/lib/store";
import { requireRole } from "@/lib/rbac";
import { insertDsaReviewRows } from "@/lib/phase-store";
import { isUuid } from "@/lib/content-api";
import {
  validatePlan,
  validateSubmissions,
  type PhasePlan,
  type SubmissionInput,
} from "@/lib/runbook";
import { sendInterviewInvite } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { pool } from "@/lib/db";
import mammoth from "mammoth";

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Use lib/pdf-parse.js directly to skip the buggy index.js
    // (index.js has a debug mode that reads a test file on require())
    const pdfParse = require("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    const text = data.text?.trim() || "";
    console.log(`PDF parsed: ${text.length} chars`);
    return text || "Resume provided but could not be parsed. Proceed with general interview questions.";
  } catch (err) {
    console.error("PDF parse failed:", err);
    return "Resume provided but could not be parsed. Proceed with general interview questions.";
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireRole(req, ["admin", "interviewer"]);
    if (auth instanceof NextResponse) return auth;
    const session = auth;

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip, 10, 60000)) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
    }

    const formData = await req.formData();
    const resumeFile = formData.get("resume") as File | null;
    const role = formData.get("role") as string;
    const level = formData.get("level") as string;
    const candidateEmail = formData.get("candidateEmail") as string;
    const candidateName = (formData.get("candidateName") as string) || "";
    const candidatePhone = (formData.get("candidatePhone") as string) || "";
    const focusAreas = (formData.get("focusAreas") as string)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const durationRaw = parseInt(formData.get("duration") as string);
    const duration = isNaN(durationRaw) ? 30 : durationRaw;
    const roundType = (formData.get("roundType") as string) || "General";
    const language = (formData.get("language") as string) || "";
    const emailTemplateId = (formData.get("emailTemplateId") as string) || "";
    const additionalContext = (formData.get("additionalContext") as string) || "";
    const questionBankId = formData.get("questionBankId") as string;

    if (!role || !level) {
      return NextResponse.json({ error: "Missing required fields: role, level" }, { status: 400 });
    }
    if (duration < 5 || duration > 180) {
      return NextResponse.json({ error: "Duration must be between 5 and 180 minutes" }, { status: 400 });
    }

    // ── DSA Review: validate the structured inputs before doing any heavy work ──
    const isDsaReview = roundType === DSA_REVIEW;
    let dsa: DsaCreateInput | null = null;
    if (isDsaReview) {
      const parsed = await parseDsaInput(formData, session.user.orgId, duration);
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      dsa = parsed;
    }

    let resumeText = "";
    let resumeFileName = "";

    if (resumeFile && resumeFile.size > 0) {
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (resumeFile.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: "Resume file too large. Maximum size is 10MB." }, { status: 400 });
      }
      const ALLOWED_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
      const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];
      const ext = resumeFile.name.toLowerCase().split(".").pop();
      if (!ALLOWED_TYPES.includes(resumeFile.type) && !ALLOWED_EXTENSIONS.includes(`.${ext}`)) {
        return NextResponse.json({ error: "Invalid file type. Supported: PDF, DOCX, TXT." }, { status: 400 });
      }
      const arrayBuffer = await resumeFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      resumeFileName = resumeFile.name;

      if (resumeFile.name.toLowerCase().endsWith(".pdf")) {
        resumeText = await extractTextFromPDF(buffer);
      } else if (resumeFile.name.toLowerCase().endsWith(".docx")) {
        const result = await mammoth.extractRawText({ buffer });
        resumeText = result.value;
      } else {
        resumeText = buffer.toString("utf-8");
      }

      console.log(`Resume parsed: ${resumeFileName}, text length: ${resumeText.length}`);
    }

    if (!resumeText) {
      resumeText = "No resume content available. Proceed with general interview questions for the role.";
    }

    // Load question bank if selected (not used by DSA Review: the runbook replaces it)
    let questionBankQuestions: string[] = [];
    if (questionBankId && !isDsaReview) {
      try {
        const { rows } = await pool.query("SELECT questions FROM question_banks WHERE id = $1", [questionBankId]);
        if (rows.length > 0 && rows[0].questions) {
          questionBankQuestions = Array.isArray(rows[0].questions) ? rows[0].questions : JSON.parse(rows[0].questions);
        }
      } catch (err) {
        console.error("Failed to load question bank:", err);
      }
    }

    // Append question bank questions to resume context.
    // Use separators for multi-line questions so formatting (tables, lists, puzzles) is preserved.
    if (questionBankQuestions.length > 0) {
      const formatted = questionBankQuestions
        .map((q, i) => `--- Question ${i + 1} ---\n${q.trim()}`)
        .join("\n\n");
      resumeText += `\n\n=== QUESTION BANK ===\nUse these questions during the interview. Preserve their exact formatting (lists, tables, line breaks) when presenting to the candidate:\n\n${formatted}\n=== END QUESTION BANK ===`;
    }

    // Append additional context (test scores, hiring manager notes, etc.)
    if (additionalContext) {
      resumeText += `\n\n--- INTERVIEWER NOTES ---\nThe hiring team has provided the following context. Use this to guide your questions and probe specific areas:\n${additionalContext}`;
    }

    const id = randomUUID();
    const token = randomBytes(32).toString("hex");

    // Interview link expires 7 days from now by default
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const interview: Interview = {
      id,
      resume: resumeText,
      resumeFileName,
      candidateEmail: candidateEmail || "",
      candidateName: candidateName || "",
      candidatePhone: candidatePhone || "",
      token,
      browserFingerprint: null,
      role,
      level,
      focusAreas: isDsaReview && focusAreas.length === 0 ? ["Problem Solving"] : focusAreas,
      duration,
      roundType,
      language,
      status: "waiting",
      transcript: [],
      proctoring: [],
      scorecard: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      expiresAt: expiresAt.toISOString(),
      orgId: session.user.orgId || undefined,
      createdBy: session.user.id || undefined,
    };

    if (dsa) {
      // Interview, submissions and phase snapshots are created atomically.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await saveInterview(interview, client);
        await insertDsaReviewRows(client, { interviewId: id, ...dsa });
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } else {
      await saveInterview(interview);
    }

    const interviewUrl = `/interview/${id}?token=${token}`;

    if (candidateEmail && emailTemplateId) {
      const fullUrl = `${req.headers.get("origin") || ""}${interviewUrl}`;
      // Load custom template from DB
      const { rows: tplRows } = await pool.query("SELECT subject, body FROM email_templates WHERE id = $1", [emailTemplateId]);
      if (tplRows.length > 0) {
        const tpl = tplRows[0];
        const orgName = (session.user as any).orgName || "InterviewAI";
        const firstName = (candidateName || "").split(" ")[0] || "there";
        // Replace template variables
        const subject = tpl.subject
          .replace(/\{\{role\}\}/g, role).replace(/\{\{orgName\}\}/g, orgName)
          .replace(/\{\{candidateName\}\}/g, candidateName || "Candidate")
          .replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{level\}\}/g, level)
          .replace(/\{\{duration\}\}/g, String(duration));
        const bodyText = tpl.body
          .replace(/\{\{role\}\}/g, role).replace(/\{\{orgName\}\}/g, orgName)
          .replace(/\{\{candidateName\}\}/g, candidateName || "Candidate")
          .replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{level\}\}/g, level)
          .replace(/\{\{duration\}\}/g, String(duration));
        // Send using the template
        const { sendCustomEmail } = await import("@/lib/email");
        sendCustomEmail(candidateEmail, subject, bodyText, fullUrl, orgName).catch(console.error);
      } else {
        sendInterviewInvite(candidateEmail, candidateName || candidateEmail, fullUrl, role, duration).catch(console.error);
      }
    } else if (candidateEmail) {
      const fullUrl = `${req.headers.get("origin") || ""}${interviewUrl}`;
      sendInterviewInvite(candidateEmail, candidateName || candidateEmail, fullUrl, role, duration).catch(console.error);
    }

    return NextResponse.json({ id, token, url: interviewUrl, candidateEmail });
  } catch (error) {
    console.error("Failed to create interview:", error);
    return NextResponse.json({ error: "Failed to create interview" }, { status: 500 });
  }
}

const DSA_REVIEW = "DSA Review";

interface DsaCreateInput {
  submissions: SubmissionInput[];
  problem: { id: string; version: number; title: string; runbook: any };
  puzzles: Array<{ id: string; version: number; title: string; runbook: any }>;
  plan: PhasePlan;
}

function jsonField(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return Symbol.for("invalid");
  }
}

async function parseDsaInput(formData: FormData, orgId: string, duration: number): Promise<DsaCreateInput | { error: string }> {
  const primaryProblemId = (formData.get("primaryProblemId") as string) || "";
  if (!isUuid(primaryProblemId)) return { error: "primaryProblemId is required for a DSA Review interview" };

  const subsRaw = jsonField(formData, "submissions");
  const puzzleIdsRaw = jsonField(formData, "puzzleIds");
  const planRaw = jsonField(formData, "plan");
  if (typeof subsRaw === "symbol" || typeof puzzleIdsRaw === "symbol" || typeof planRaw === "symbol") {
    return { error: "submissions, puzzleIds and plan must be valid JSON" };
  }

  const { rows: problemRows } = await pool.query(
    "SELECT id, title, version, runbook FROM problems WHERE id = $1 AND org_id = $2 AND is_archived = false",
    [primaryProblemId, orgId]
  );
  if (problemRows.length === 0) return { error: "Primary problem not found in your organization" };
  const problem = problemRows[0];

  // The primary submission is always for the chosen problem; default its title from the problem.
  const subsInput = Array.isArray(subsRaw)
    ? subsRaw.map((s: any) => (s && s.isPrimary === true && !String(s.problemTitle || "").trim() ? { ...s, problemTitle: problem.title } : s))
    : subsRaw;
  const subs = validateSubmissions(subsInput);
  if (!subs.ok) return { error: subs.errors[0] };

  // Context submissions may reference a problem, but only one from this org.
  const refIds = subs.value.filter((s) => !s.isPrimary && s.problemId && isUuid(s.problemId)).map((s) => s.problemId as string);
  let validRefs: string[] = [];
  if (refIds.length > 0) {
    const { rows } = await pool.query("SELECT id FROM problems WHERE id = ANY($1::uuid[]) AND org_id = $2", [refIds, orgId]);
    validRefs = rows.map((r) => r.id);
  }
  const submissions = subs.value.map((s) => (s.isPrimary || (s.problemId && validRefs.indexOf(s.problemId) !== -1) ? s : { ...s, problemId: null }));

  const puzzleIds: string[] = Array.isArray(puzzleIdsRaw) ? Array.from(new Set(puzzleIdsRaw.map(String))) : [];
  if (puzzleIds.some((p) => !isUuid(p))) return { error: "puzzleIds must be valid ids" };
  let puzzles: DsaCreateInput["puzzles"] = [];
  if (puzzleIds.length > 0) {
    const { rows } = await pool.query(
      "SELECT id, title, version, runbook FROM puzzles WHERE id = ANY($1::uuid[]) AND org_id = $2 AND is_archived = false",
      [puzzleIds, orgId]
    );
    if (rows.length !== puzzleIds.length) return { error: "One or more puzzles were not found in your organization" };
    // Keep the interviewer's order (matters for "ordered" selection).
    puzzles = puzzleIds.map((pid) => rows.find((r) => r.id === pid)!);
  }

  const plan = validatePlan(planRaw, duration);
  if (!plan.ok) return { error: plan.errors[0] };

  return { submissions, problem, puzzles, plan: plan.value };
}
