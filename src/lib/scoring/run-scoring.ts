// One scoring pipeline shared by the end route, the rescore route and the AI-initiated end:
// global transcript pass (as before) + per-phase rubric scoring for DSA Review, rolled into the five dimensions.
import { generateScorecard } from "../ai";
import { getOrgAISettings } from "../ai-settings";
import { normalizeScorecard } from "../normalize-scorecard";
import { parseScorecardJSON } from "../parse-scorecard";
import { calculateOverall, calculateRecommendation, type DimScores } from "../scorecard-calc";
import type { Interview } from "../store";
import { getPhases } from "../phase-store";
import { describePhase, scorePhase, toRollupInput, type PhaseScorecard } from "./phase-scoring";
import { rollupDimensions } from "./rollup";

/**
 * Final scoring, in order:
 *  1. each stage that actually ran is scored against its rubric (the item's own plus the runbook's extra criteria);
 *  2. the server rolls those credits up (hint discounts, stage weights) into the five dimensions;
 *  3. the final scoring AI gets the whole transcript AND every stage's result, and writes the summary, strengths,
 *     weaknesses, and the dimensions the rubrics do not cover;
 *  4. the server overwrites the rubric-covered dimensions and computes overall + recommendation from the org thresholds.
 */
export async function buildScorecard(interview: Interview): Promise<ReturnType<typeof normalizeScorecard>> {
  const isDsa = interview.roundType === "DSA Review";

  const phaseResult = isDsa ? await scoreCompletedPhases(interview) : null;
  const parsed = parseScorecardJSON(await generateScorecard(interview, phaseResult ? formatStageResults(phaseResult.described, phaseResult.skipped) : undefined));

  if (phaseResult) {
    const { scores, sources } = rollupDimensions(phaseResult.inputs);
    Object.keys(scores).forEach((dim) => {
      parsed[dim] = (scores as any)[dim];
    });
    parsed.phases = phaseResult.described;
    parsed.dimensionSources = sources;
  }

  const dimScores: DimScores = {
    technicalDepth: parsed.technicalDepth ?? 3,
    communication: parsed.communication ?? 3,
    problemSolving: parsed.problemSolving ?? 3,
    domainKnowledge: parsed.domainKnowledge ?? 3,
    cultureFit: parsed.cultureFit ?? 3,
  };
  const orgSettings = await getOrgAISettings(interview.orgId);
  parsed.overall = calculateOverall(dimScores, interview.role);
  parsed.recommendation = calculateRecommendation(parsed.overall, dimScores, orgSettings);
  return normalizeScorecard(parsed);
}

/** The stage results as text for the final scoring AI. */
export function formatStageResults(described: ReturnType<typeof describePhase>[], skipped: Array<{ key: string; reason: string }>): string {
  const label = (k: string) => (k === "parta" ? "Part A evaluation" : k === "dsa" ? "DSA problem" : "Puzzle");
  const lines = described.map((p, i) => {
    if (p.score === null) return `STAGE ${i + 1}: ${label(p.key)} "${p.title}": not scored (${(p as any).skipReason || "too little to score"}).`;
    const hints = p.hintsUsed.length ? p.hintsUsed.map((h) => `hint ${h.order} at minute ${h.atMin}`).join(", ") : "none";
    const criteria = p.criteria.map((c) => `  - [${c.credit}] ${c.text}${c.evidence ? ` (evidence: ${c.evidence})` : ""}`).join("\n");
    return `STAGE ${i + 1}: ${label(p.key)} "${p.title}": score ${p.score}/5 after hint discount, ${p.durationMin} min, weak answers ${p.weakAnswers}, hints used: ${hints}${p.finalAnswerCorrect !== undefined ? `, final answer ${p.finalAnswerCorrect ? "correct" : "not correct"}` : ""}.\n${criteria}\n  Assessor notes: ${p.notes || "none"}`;
  });
  const skip = skipped.map((s) => `NOT RUN: ${label(s.key)} (${s.reason})`);
  return [...lines, ...skip].join("\n\n");
}

async function scoreCompletedPhases(interview: Interview) {
  const phases = (await getPhases(interview.id)).filter((p) => p.status === "completed");
  const withInterview: Interview = { ...interview, phases };
  const results = await Promise.all(phases.map((p) => scorePhase(withInterview, p)));
  const inputs = phases
    .map((p, i) => toRollupInput(p, results[i]))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const described = phases.map((p, i) => describePhase(p, results[i] as PhaseScorecard));
  const skipped = (await getPhases(interview.id)).filter((p) => p.status === "skipped").map((p) => ({ key: p.phaseKey, reason: (p.endReason || "skipped").replace(/_/g, " ") }));
  return { inputs, described, skipped };
}
