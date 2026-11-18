"use client";

// The puzzle editor's Stages section: one card per stage (Question and Accepted answer, cue phrases under Advanced).
// Stage 1 is always there; stages are numbered by their order. One stage = a plain one-question puzzle.
import { useState } from "react";
import { MAX_PUZZLE_STAGES } from "@/lib/runbook";
import { emptyStage, type PuzzleStageForm } from "@/lib/puzzle-form";
import { AddButton } from "./fields";

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white transition disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "border-red-200 text-red-600 hover:bg-red-50" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
    >
      {children}
    </button>
  );
}

export function PuzzleStagesEditor({ stages, onChange, notice }: { stages: PuzzleStageForm[]; onChange: (s: PuzzleStageForm[]) => void; notice?: string }) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [advancedOpen, setAdvancedOpen] = useState<Record<number, boolean>>({});

  const set = (i: number, patch: Partial<PuzzleStageForm>) => onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, to: number) => {
    if (to < 0 || to >= stages.length) return;
    const next = stages.slice();
    const [s] = next.splice(i, 1);
    next.splice(to, 0, s);
    onChange(next);
    setCollapsed({});
    setAdvancedOpen({});
  };
  const remove = (i: number) => {
    if (i === 0) return;
    onChange(stages.filter((_, j) => j !== i));
    setCollapsed({});
    setAdvancedOpen({});
  };
  const multi = stages.length >= 2;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {multi ? "The candidate moves through these in order. How to ask and when to move on stay in the runbook." : "A one-question puzzle has just Stage 1. Add a stage to make it multi-stage."}
        </p>
        {multi && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600" aria-label={`Candidate will see ${stages.length} stage boxes`}>
            <span>Candidate will see</span>
            {stages.map((_, i) => (
              <span key={i} className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-gray-300 px-1.5 text-[11px] font-semibold text-gray-700">{i + 1}</span>
            ))}
          </div>
        )}
      </div>

      {notice && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{notice}</p>}

      {stages.map((s, i) => {
        const n = i + 1;
        const isCollapsed = !!collapsed[i] && i > 0;
        const advanced = !!advancedOpen[i] || s.cues.length > 0;
        return (
          <div key={i} className={`rounded-lg border p-3 ${i === 0 ? "border-indigo-200 bg-indigo-50/40" : "border-gray-200 bg-gray-50"}`}>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => i > 0 && setCollapsed((c) => ({ ...c, [i]: !c[i] }))}
                className="min-w-0 text-left"
                aria-expanded={!isCollapsed}
                disabled={i === 0}
              >
                <span className="text-sm font-semibold text-gray-900">Stage {n}</span>
                {i === 0 && <span className="ml-2 text-xs text-gray-500">always there</span>}
                {isCollapsed && <span className="ml-2 truncate text-xs text-gray-500">· {s.questionMd.trim().slice(0, 80) || "no question yet"}</span>}
              </button>
              <div className="flex shrink-0 gap-1">
                <IconButton label={`Move stage ${n} up`} onClick={() => move(i, i - 1)} disabled={i === 0}>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5L6 4.5l3 3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </IconButton>
                <IconButton label={`Move stage ${n} down`} onClick={() => move(i, i + 1)} disabled={i === stages.length - 1}>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </IconButton>
                {i > 0 && (
                  <IconButton label={`Delete stage ${n}`} onClick={() => remove(i)} danger>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 3.5h7M5 3.5V2.5h2v1M3.5 3.5l.5 6h4l.5-6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </IconButton>
                )}
              </div>
            </div>

            {!isCollapsed && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="label" htmlFor={`stage-${i}-q`}>Question <span className="text-red-500">*</span></label>
                  <textarea
                    id={`stage-${i}-q`}
                    value={s.questionMd}
                    onChange={(e) => set(i, { questionMd: e.target.value })}
                    rows={3}
                    className="input-field"
                    placeholder={i === 0 ? "e.g. The party starts in 24 hours and the poison kills in 24 hours. What is the minimum number of testers?" : "e.g. Now the party starts in 48 hours. Can you do better?"}
                  />
                </div>
                <div>
                  <label className="label" htmlFor={`stage-${i}-a`}>Accepted answer <span className="text-red-500">*</span></label>
                  <textarea
                    id={`stage-${i}-a`}
                    value={s.answer}
                    onChange={(e) => set(i, { answer: e.target.value })}
                    rows={2}
                    className="input-field"
                    placeholder="The right answer and why, judged by the AI (not string-matched)"
                  />
                </div>
                <div className="border-t border-dashed border-gray-200 pt-2">
                  <button type="button" onClick={() => setAdvancedOpen((a) => ({ ...a, [i]: !advanced }))} className="text-xs font-medium text-gray-600 hover:text-gray-900" aria-expanded={advanced}>
                    {advanced ? "▾" : "▸"} Advanced
                  </button>
                  {advanced && (
                    <div className="mt-2">
                      <label className="label" htmlFor={`stage-${i}-cues`}>Cue phrases <span className="font-normal text-gray-400">(optional, comma-separated)</span></label>
                      <input
                        id={`stage-${i}-cues`}
                        value={s.cues.join(", ")}
                        onChange={(e) => set(i, { cues: e.target.value.split(",").map((c) => c.trimStart()) })}
                        className="input-field"
                        placeholder={i === 0 ? "Not needed for Stage 1" : "e.g. 48 hours"}
                      />
                      <p className="mt-1 text-xs text-gray-400">Words only this stage's question uses. If the AI forgets to mark the stage change, these tell the server it moved on.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {stages.length < MAX_PUZZLE_STAGES ? (
        <AddButton onClick={() => onChange([...stages, emptyStage()])}>Add stage</AddButton>
      ) : (
        <p className="text-xs text-gray-500">At most {MAX_PUZZLE_STAGES} stages.</p>
      )}
    </div>
  );
}
