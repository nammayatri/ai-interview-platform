"use client";

// DSA Review sections of the review page: phase timeline, per-phase rubric results with evidence,
// hints used, the submitted code and the candidate's final scratchpad.
import { DIMENSION_LABELS, type Dimension } from "@/lib/runbook";

export interface ScorecardPhase {
  key: "dsa" | "puzzle";
  title: string;
  status: "completed" | "skipped";
  skipReason?: string;
  durationMin: number;
  endReason: string;
  score: number | null;
  rawCredit?: number;
  hintDiscount?: number;
  creditAfterDiscount?: number;
  criteria: Array<{ id: string; text: string; weight: number; credit: string; evidence: string; mapsTo: Dimension }>;
  hintsUsed: Array<{ order: number; atMin: number; text: string }>;
  weakAnswers: number;
  finalAnswerCorrect?: boolean;
  notes: string;
}

interface PhaseRowLite { phaseKey: string; status: string; startedAt: string | null; endedAt: string | null; endReason: string | null; budgetMin: number | null; config?: any }
interface SubmissionLite { id: string; problemTitle: string; language: string; code: string; outcome: string; score: number | null; testsPassed: number | null; testsTotal: number | null; externalUrl: string; notes: string; isPrimary: boolean }

const END_REASON: Record<string, string> = {
  ai_done: "Finished by the interviewer",
  hard_cap: "Time cap reached",
  forced: "Ended by a person",
  interview_end: "Interview ended",
  skipped_no_time: "Skipped: not enough time left",
  skipped_no_pool: "Skipped: no puzzle available",
};

const CREDIT_STYLE: Record<string, string> = {
  met: "bg-green-50 text-green-700 border-green-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  missed: "bg-red-50 text-red-700 border-red-200",
};

const minutes = (a: string | null, b: string | null) => (a && b ? Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 60000) * 10) / 10 : null);

function phaseLabel(key: string) { return key === "dsa" ? "DSA discussion" : "Puzzle"; }

export function ReviewPhases({ phases, dimensionSources, interviewPhases, submissions, scratchpad }: {
  phases?: ScorecardPhase[];
  dimensionSources?: Record<string, "rubric" | "global">;
  interviewPhases?: PhaseRowLite[];
  submissions?: SubmissionLite[];
  scratchpad?: string;
}) {
  const scored = phases || [];
  const timeline = interviewPhases && interviewPhases.length
    ? interviewPhases
    : scored.map((p) => ({ phaseKey: p.key, status: p.status, startedAt: null, endedAt: null, endReason: p.endReason, budgetMin: null } as PhaseRowLite));
  const primary = submissions?.find((s) => s.isPrimary);
  const others = submissions?.filter((s) => !s.isPrimary) || [];

  return (
    <>
      <div className="card p-6 space-y-4 animate-fade-in-up delay-1">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Phase timeline</h2>
        <ol className="grid gap-3 sm:grid-cols-2">
          {timeline.map((p) => {
            const title = scored.find((s) => s.key === p.phaseKey)?.title || (p.config?.problemTitle ?? p.config?.selected?.title ?? "");
            const dur = scored.find((s) => s.key === p.phaseKey)?.durationMin ?? minutes(p.startedAt, p.endedAt);
            return (
              <li key={p.phaseKey} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{phaseLabel(p.phaseKey)}</span>
                  <span className={p.status === "skipped" ? "badge-warning" : "badge-success"}>{p.status}</span>
                </div>
                {title && <p className="text-xs text-gray-500 mt-0.5 truncate">{title}</p>}
                <p className="text-xs text-gray-500 mt-1">
                  {dur !== null && dur !== undefined ? `${dur} min` : "n/a"}{p.budgetMin ? ` of ${p.budgetMin} planned` : ""}
                  {p.endReason ? ` · ${END_REASON[p.endReason] || p.endReason}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
        {dimensionSources && (
          <p className="text-xs text-gray-500">
            Dimension scores from the rubric roll-up:{" "}
            {Object.entries(dimensionSources).filter(([, v]) => v === "rubric").map(([k]) => DIMENSION_LABELS[k as Dimension] || k).join(", ") || "none"}.
            {" "}Others come from the whole-transcript review.
          </p>
        )}
      </div>

      {scored.map((p) => (
        <div key={p.key} className="card p-6 space-y-4 animate-fade-in-up delay-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">{phaseLabel(p.key)} rubric</h2>
              <p className="text-base font-semibold text-gray-900 mt-0.5">{p.title}</p>
            </div>
            {p.score !== null ? (
              <div className="text-right">
                <p className="text-2xl font-bold text-gray-900">{p.score.toFixed(1)}<span className="text-sm font-normal text-gray-400"> / 5</span></p>
                {p.rawCredit !== undefined && (
                  <p className="text-[11px] text-gray-500">
                    raw {Math.round(p.rawCredit * 100)}%{p.hintDiscount ? ` − hints ${Math.round(p.hintDiscount * 100)}%` : ""} = {Math.round((p.creditAfterDiscount ?? p.rawCredit) * 100)}%
                  </p>
                )}
              </div>
            ) : (
              <span className="badge-warning">{p.skipReason || "Not scored"}</span>
            )}
          </div>

          {p.notes && <p className="text-sm text-gray-700 leading-relaxed">{p.notes}</p>}

          <div className="flex flex-wrap gap-4 text-xs text-gray-600">
            <span>Weak answers: <strong>{p.weakAnswers}</strong></span>
            <span>Hints used: <strong>{p.hintsUsed.length}</strong></span>
            {p.finalAnswerCorrect !== undefined && <span>Final answer: <strong>{p.finalAnswerCorrect ? "correct" : "not correct"}</strong></span>}
          </div>

          {p.hintsUsed.length > 0 && (
            <ul className="space-y-1.5">
              {p.hintsUsed.map((h) => (
                <li key={h.order} className="text-xs rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-amber-900">
                  <strong>Hint {h.order}</strong> at minute {h.atMin}: {h.text}
                </li>
              ))}
            </ul>
          )}

          {p.score !== null && (
            <div className="space-y-2">
              {p.criteria.map((c) => (
                <div key={c.id} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-gray-800">{c.text}</p>
                    <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${CREDIT_STYLE[c.credit] || ""}`}>{c.credit}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">weight {c.weight} · {DIMENSION_LABELS[c.mapsTo] || c.mapsTo}</p>
                  {c.evidence && <blockquote className="mt-1.5 border-l-2 border-gray-200 pl-3 text-xs italic text-gray-600">{c.evidence}</blockquote>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {primary && (
        <div className="card p-6 space-y-3 animate-fade-in-up delay-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Submitted code</h2>
            <p className="text-xs text-gray-500">
              {primary.problemTitle} · {primary.language || "language n/a"} · <strong>{primary.outcome}</strong>
              {primary.testsTotal !== null ? ` · ${primary.testsPassed ?? "?"}/${primary.testsTotal} tests` : ""}
              {primary.score !== null ? ` · score ${primary.score}` : ""}
              {primary.externalUrl && (<> · <a href={primary.externalUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">HackerRank</a></>)}
            </p>
          </div>
          {primary.notes && <p className="text-xs text-gray-600">Note: {primary.notes}</p>}
          <pre className="max-h-[420px] overflow-auto rounded-lg bg-gray-900 p-3 text-[12px] leading-5 text-gray-100">
            {primary.code.split("\n").map((l, i) => (<div key={i} className="flex"><span className="mr-3 w-8 shrink-0 select-none text-right text-gray-500">{i + 1}</span><span className="whitespace-pre-wrap break-all">{l || " "}</span></div>))}
          </pre>
          {others.length > 0 && (
            <p className="text-xs text-gray-500">Context only: {others.map((o) => `${o.problemTitle} (${o.outcome})`).join(", ")}</p>
          )}
        </div>
      )}

      <div className="card p-6 space-y-2 animate-fade-in-up delay-3">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Final scratchpad</h2>
        {scratchpad && scratchpad.trim() ? (
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-800">{scratchpad}</pre>
        ) : (
          <p className="text-sm text-gray-400">The candidate did not use the scratchpad.</p>
        )}
      </div>
    </>
  );
}
