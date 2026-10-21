// Creating a staged coding-evaluation interview. Shared by the single-interview form (/api/create-interview) and
// the bulk upload (/api/bulk-interviews), so both go through exactly the same validation and snapshots.
import { randomBytes, randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { isUuid } from "./content-api";
import { sendCustomEmail, sendInterviewInvite } from "./email";
import { insertPhaseRows, insertSubmission, type PhaseInsert } from "./phase-store";
import {
  BUILTIN_RUNBOOKS,
  DEFAULT_STAGE_WEIGHTS,
  snapshotDsaConfig,
  snapshotPartAConfig,
  snapshotPuzzleConfig,
  validateStages,
  validateSubmissions,
  type StageFlow,
  type StageKey,
  type StagePlan,
  type SubmissionInput,
} from "./runbook";
import { saveInterview, type Interview } from "./store";


type Row = { id: string; title: string; version: number; runbook: any };

export interface StagesCreateInput {
  stages: StagePlan[];
  /** Part A only */
  submission: SubmissionInput | null;
  partaProblem: Row | null;
  dsaPool: Row[];
  puzzlePool: Row[];
  flows: Record<StageKey, StageFlow>;
}

export function jsonField(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return Symbol.for("invalid");
  }
}

async function loadFlow(plan: StagePlan, orgId: string): Promise<StageFlow | { error: string }> {
  if (!plan.runbookId) return { ...BUILTIN_RUNBOOKS[plan.key], runbookId: null, runbookVersion: 0 };
  const { rows } = await pool.query(
    "SELECT id, name, description, instructions, probes, rubric, version FROM runbooks WHERE id = $1 AND org_id = $2 AND kind = $3 AND is_archived = false",
    [plan.runbookId, orgId, plan.key]
  );
  if (rows.length === 0) return { error: `The runbook chosen for the ${plan.key} stage was not found` };
  const r = rows[0];
  return { runbookId: r.id, runbookVersion: r.version, name: r.name, description: r.description, instructions: r.instructions, probes: r.probes || [], rubric: r.rubric || [] };
}

export async function parseStagesFormData(formData: FormData, orgId: string, duration: number): Promise<StagesCreateInput | { error: string }> {
  const stagesRaw = jsonField(formData, "stages");
  const subRaw = jsonField(formData, "partaSubmission");
  if (typeof stagesRaw === "symbol" || typeof subRaw === "symbol") return { error: "stages and partaSubmission must be valid JSON" };
  return loadStagedInput(stagesRaw, subRaw, orgId, duration);
}

/** Validates the stage list and loads everything it points at (questions, problems, puzzles, runbooks) for this org. */
export async function loadStagedInput(stagesRaw: unknown, subRaw: unknown, orgId: string, duration: number): Promise<StagesCreateInput | { error: string }> {

  const v = validateStages(stagesRaw, duration);
  if (!v.ok) return { error: v.errors[0] };
  const stages = v.value;
  const out: StagesCreateInput = { stages, submission: null, partaProblem: null, dsaPool: [], puzzlePool: [], flows: {} as Record<StageKey, StageFlow> };

  for (const st of stages) {
    const flow = await loadFlow(st, orgId);
    if ("error" in flow) return flow;
    out.flows[st.key] = flow;

    if (st.key === "parta") {
      const { rows } = await pool.query(
        "SELECT id, title, version, runbook FROM problems WHERE id = $1 AND org_id = $2 AND kind = 'parta' AND is_archived = false",
        [st.itemId, orgId]
      );
      if (rows.length === 0) return { error: "The Part A question was not found in your organization" };
      out.partaProblem = rows[0];
      const sub = validateSubmissions([{ ...(subRaw && typeof subRaw === "object" ? (subRaw as object) : {}), problemTitle: rows[0].title, isPrimary: true }]);
      if (!sub.ok) return { error: `Part A submission: ${sub.errors[0]}` };
      out.submission = sub.value[0];
    } else if (st.key === "dsa") {
      const { rows } =
        st.mode === "specific"
          ? await pool.query("SELECT id, title, version, runbook FROM problems WHERE id = $1 AND org_id = $2 AND kind = 'dsa' AND is_archived = false", [st.itemId, orgId])
          : await pool.query("SELECT id, title, version, runbook FROM problems WHERE org_id = $1 AND kind = 'dsa' AND is_archived = false ORDER BY title", [orgId]);
      if (rows.length === 0) return { error: st.mode === "specific" ? "The DSA problem was not found in your organization" : "There are no DSA problems to pick from at random. Add one first" };
      out.dsaPool = rows;
    } else {
      const { rows } =
        st.mode === "specific"
          ? await pool.query("SELECT id, title, version, runbook FROM puzzles WHERE id = $1 AND org_id = $2 AND is_archived = false", [st.itemId, orgId])
          : await pool.query("SELECT id, title, version, runbook FROM puzzles WHERE org_id = $1 AND is_archived = false ORDER BY title", [orgId]);
      if (rows.length === 0) return { error: st.mode === "specific" ? "The puzzle was not found in your organization" : "There are no puzzles to pick from at random. Add one first" };
      out.puzzlePool = rows;
    }
  }
  return out;
}

/** Writes the Part A submission and one pending phase per stage (in order), with their snapshots. Inside the caller's transaction. */
export async function insertStages(client: import("pg").PoolClient, interviewId: string, inp: StagesCreateInput) {
  let submissionId = "";
  if (inp.submission && inp.partaProblem) submissionId = await insertSubmission(client, interviewId, inp.partaProblem.id, inp.submission);

  const phases: PhaseInsert[] = inp.stages.map((st) => {
    const flow = inp.flows[st.key];
    let config: unknown;
    if (st.key === "parta") config = snapshotPartAConfig(inp.partaProblem!, submissionId, [], flow);
    else if (st.key === "dsa") config = snapshotDsaConfig(inp.dsaPool, st.mode, flow);
    else config = snapshotPuzzleConfig(inp.puzzlePool, st.mode === "random" ? "random" : "specific", flow);
    return { phaseKey: st.key, budgetMin: st.budgetMin, graceMin: st.graceMin, earlyDoneAfterMin: st.earlyDoneAfterMin, weight: DEFAULT_STAGE_WEIGHTS[st.key], config };
  });
  await insertPhaseRows(client, interviewId, phases);
}

export interface CreateStagedArgs {
  orgId: string;
  userId: string;
  role: string;
  level: string;
  duration: number;
  candidateEmail: string;
  candidateName?: string;
  candidatePhone?: string;
  resumeText?: string;
  resumeFileName?: string;
  additionalContext?: string;
  focusAreas?: string[];
  language?: string;
  input: StagesCreateInput;
  /** Set when the interview is a registration in a batch (shared join link). */
  batchId?: string;
  /** Overrides the default 7-day link expiry. */
  expiresAt?: Date;
}

/** Writes the interview, the Part A submission and every stage's snapshot in one transaction. */
export async function createStagedInterview(a: CreateStagedArgs): Promise<{ id: string; token: string; url: string }> {
  let resume = a.resumeText || "No resume content available. Proceed with general interview questions for the role.";
  if (a.additionalContext) {
    resume += `\n\n--- INTERVIEWER NOTES ---\nThe hiring team has provided the following context. Use this to guide your questions and probe specific areas:\n${a.additionalContext}`;
  }
  const id = randomUUID();
  const token = randomBytes(32).toString("hex");
  const expiresAt = a.expiresAt ?? new Date();
  if (!a.expiresAt) expiresAt.setDate(expiresAt.getDate() + 7); // the link expires 7 days from now

  const interview: Interview = {
    id,
    resume,
    resumeFileName: a.resumeFileName || "",
    candidateEmail: a.candidateEmail,
    candidateName: a.candidateName || "",
    candidatePhone: a.candidatePhone || "",
    token,
    browserFingerprint: null,
    role: a.role,
    level: a.level,
    focusAreas: a.focusAreas && a.focusAreas.length ? a.focusAreas : ["Problem Solving"],
    duration: a.duration,
    roundType: "DSA Review",
    language: a.language || "",
    status: "waiting",
    transcript: [],
    proctoring: [],
    scorecard: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    expiresAt: expiresAt.toISOString(),
    orgId: a.orgId,
    createdBy: a.userId,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await saveInterview(interview, client);
    if (a.batchId) await client.query("UPDATE interviews SET batch_id = $1 WHERE id = $2", [a.batchId, id]);
    await insertStages(client, id, a.input);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { id, token, url: `/interview/${id}?token=${token}` };
}

/** Emails the candidate their link: the chosen email template, or the default invite when none is chosen. */
export async function sendCandidateInvite(a: {
  origin: string;
  url: string;
  candidateEmail: string;
  candidateName?: string;
  role: string;
  level: string;
  duration: number;
  orgName?: string;
  emailTemplateId?: string;
}): Promise<void> {
  if (!a.candidateEmail) return;
  const fullUrl = `${a.origin}${a.url}`;
  if (a.emailTemplateId && isUuid(a.emailTemplateId)) {
    const { rows } = await pool.query("SELECT subject, body FROM email_templates WHERE id = $1", [a.emailTemplateId]);
    if (rows.length > 0) {
      const orgName = a.orgName || "InterviewAI";
      const firstName = (a.candidateName || "").split(" ")[0] || "there";
      const fill = (t: string) =>
        t.replace(/\{\{role\}\}/g, a.role).replace(/\{\{orgName\}\}/g, orgName)
          .replace(/\{\{candidateName\}\}/g, a.candidateName || "Candidate")
          .replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{level\}\}/g, a.level)
          .replace(/\{\{duration\}\}/g, String(a.duration));
      await sendCustomEmail(a.candidateEmail, fill(rows[0].subject), fill(rows[0].body), fullUrl, orgName);
      return;
    }
  }
  await sendInterviewInvite(a.candidateEmail, a.candidateName || a.candidateEmail, fullUrl, a.role, a.duration);
}
