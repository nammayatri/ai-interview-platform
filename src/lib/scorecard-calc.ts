import type { AISettings } from "./ai-settings";

export interface DimScores {
  technicalDepth: number;
  communication: number;
  problemSolving: number;
  domainKnowledge: number;
  cultureFit: number;
}

/** Role-weighted dimension importance (sums to 1.0). */
export function getRoleWeights(role: string): DimScores {
  const r = role.toLowerCase();
  if (/sde|engineer|developer|backend|frontend|fullstack/.test(r))
    return { technicalDepth: 0.35, problemSolving: 0.25, domainKnowledge: 0.20, communication: 0.10, cultureFit: 0.10 };
  if (/product|pm/.test(r))
    return { problemSolving: 0.25, communication: 0.25, domainKnowledge: 0.20, technicalDepth: 0.15, cultureFit: 0.15 };
  if (/sales|bd/.test(r))
    return { communication: 0.35, domainKnowledge: 0.20, cultureFit: 0.20, problemSolving: 0.15, technicalDepth: 0.10 };
  if (/hr|human resource/.test(r))
    return { communication: 0.30, cultureFit: 0.25, domainKnowledge: 0.20, problemSolving: 0.15, technicalDepth: 0.10 };
  if (/design|ux/.test(r))
    return { domainKnowledge: 0.30, problemSolving: 0.25, communication: 0.20, technicalDepth: 0.15, cultureFit: 0.10 };
  if (/data|analyst/.test(r))
    return { technicalDepth: 0.30, domainKnowledge: 0.25, problemSolving: 0.25, communication: 0.10, cultureFit: 0.10 };
  if (/manager|director|lead|head|ceo|cto/.test(r))
    return { communication: 0.25, problemSolving: 0.25, cultureFit: 0.20, domainKnowledge: 0.20, technicalDepth: 0.10 };
  if (/ops|operations/.test(r))
    return { problemSolving: 0.30, domainKnowledge: 0.25, communication: 0.20, technicalDepth: 0.15, cultureFit: 0.10 };
  return { technicalDepth: 0.25, communication: 0.20, problemSolving: 0.20, domainKnowledge: 0.20, cultureFit: 0.15 };
}

/**
 * Compute overall as a simple average.
 * - cultureFit >= 3 → (tech + comm + prob + domain) / 4   (excluded)
 * - cultureFit <  3 → (tech + comm + prob + domain + culture) / 5   (included as penalty)
 */
export type DimKey = keyof DimScores;

/**
 * `notAssessed` lists dimensions this interview never tested (for example technical depth and domain knowledge in a
 * puzzle-only interview). They are left out of the average and of every minimum, so a candidate is not marked down
 * for something that was not asked.
 */
export function calculateOverall(scores: DimScores, _role: string, notAssessed: DimKey[] = []): number {
  const core = (["technicalDepth", "communication", "problemSolving", "domainKnowledge"] as DimKey[]).filter((d) => !notAssessed.includes(d));
  const otherSum = core.reduce((n, d) => n + scores[d], 0);
  if (core.length === 0) return Math.round(scores.cultureFit * 100) / 100;
  const overall = scores.cultureFit >= 3 || notAssessed.includes("cultureFit")
    ? otherSum / core.length
    : (otherSum + scores.cultureFit) / (core.length + 1);
  return Math.round(overall * 100) / 100;
}

/** Determine recommendation based on org settings + computed overall + per-dim scores. */
export function calculateRecommendation(
  overall: number,
  scores: DimScores,
  settings: AISettings,
  notAssessed: DimKey[] = []
): "strong_hire" | "hire" | "no_hire" | "strong_no_hire" {
  const t = settings.scoring;
  const allDims: number[] = (["technicalDepth", "communication", "problemSolving", "domainKnowledge", "cultureFit"] as DimKey[])
    .filter((d) => !notAssessed.includes(d))
    .map((d) => scores[d]);
  const okMin = (d: DimKey) => notAssessed.includes(d) || scores[d] >= t.hireMinDims[d];

  // strong_hire: high overall + all dims meet uniform min
  if (overall >= t.strongHireOverall && allDims.every((s) => s >= t.strongHireMinDim)) {
    return "strong_hire";
  }

  // hire: overall >= threshold AND each dim meets its specific minimum
  if (
    overall >= t.hireOverall &&
    okMin("technicalDepth") &&
    okMin("communication") &&
    okMin("problemSolving") &&
    okMin("domainKnowledge") &&
    okMin("cultureFit")
  ) {
    return "hire";
  }

  // strong_no_hire
  if (overall < t.strongNoHireOverall) return "strong_no_hire";

  return "no_hire";
}
