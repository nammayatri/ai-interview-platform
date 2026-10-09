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

export async function buildScorecard(interview: Interview): Promise<ReturnType<typeof normalizeScorecard>> {
  const isDsa = interview.roundType === "DSA Review";

  const globalPass = generateScorecard(interview).then(parseScorecardJSON);
  const phasePass = isDsa ? scoreCompletedPhases(interview) : Promise.resolve(null);
  const [parsed, phaseResult] = await Promise.all([globalPass, phasePass]);

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

async function scoreCompletedPhases(interview: Interview) {
  const phases = (await getPhases(interview.id)).filter((p) => p.status === "completed");
  const withInterview: Interview = { ...interview, phases };
  const results = await Promise.all(phases.map((p) => scorePhase(withInterview, p)));
  const inputs = phases
    .map((p, i) => toRollupInput(p, results[i]))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const described = phases.map((p, i) => describePhase(p, results[i] as PhaseScorecard));
  return { inputs, described };
}
