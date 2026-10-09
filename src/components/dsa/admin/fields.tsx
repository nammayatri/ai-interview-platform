"use client";

// Small form building blocks shared by the problem and puzzle editors.
import { useState } from "react";
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "@/lib/runbook";
import { Markdown } from "../Markdown";

export function MarkdownField({ label, value, onChange, rows = 8, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="label !mb-0">{label}</label>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setPreview(false)} className={`px-2 py-0.5 rounded ${!preview ? "bg-indigo-50 text-indigo-600" : "text-gray-500"}`}>Edit</button>
          <button type="button" onClick={() => setPreview(true)} className={`px-2 py-0.5 rounded ${preview ? "bg-indigo-50 text-indigo-600" : "text-gray-500"}`}>Preview</button>
        </div>
      </div>
      {preview ? (
        <div className="border border-gray-200 rounded-lg p-3 min-h-[8rem] bg-white"><Markdown>{value || "*Nothing to preview*"}</Markdown></div>
      ) : (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="input-field font-mono text-xs" />
      )}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function StringListEditor({ label, items, onChange, placeholder, multiline = false, hint }: {
  label: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string; multiline?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2 items-start">
            {multiline ? (
              <textarea value={it} rows={2} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} placeholder={placeholder} className="input-field" />
            ) : (
              <input value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} placeholder={placeholder} className="input-field" />
            )}
            <RemoveButton onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
        ))}
        <AddButton onClick={() => onChange([...items, ""])}>Add</AddButton>
      </div>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove" className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition shrink-0">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
    </button>
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 transition">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
      {children}
    </button>
  );
}

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5 mb-3">{subtitle}</p>}
      <div className={`space-y-4 ${subtitle ? "" : "mt-3"}`}>{children}</div>
    </section>
  );
}

const numVal = (v: any) => (v === undefined || v === null ? "" : v);
const toNum = (s: string) => (s === "" ? "" : Number(s));

export function HintLadderEditor({ hints, onChange }: { hints: any[]; onChange: (h: any[]) => void }) {
  const set = (i: number, patch: any) => onChange(hints.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const renumber = (list: any[]) => list.map((h, i) => ({ ...h, order: i + 1 }));
  return (
    <div className="space-y-3">
      {hints.map((h, i) => (
        <div key={i} className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600">Hint {i + 1}</span>
            <RemoveButton onClick={() => onChange(renumber(hints.filter((_, j) => j !== i)))} />
          </div>
          <textarea value={h.text || ""} rows={2} onChange={(e) => set(i, { text: e.target.value })} placeholder="The nudge, spoken as written" className="input-field" />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-gray-500">Not before minute</label>
              <input type="number" min={0} value={numVal(h.notBeforeMin)} onChange={(e) => set(i, { notBeforeMin: toNum(e.target.value) })} placeholder="any" className="input-field" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500">After weak answers</label>
              <input type="number" min={0} value={numVal(h.afterWeakAnswers)} onChange={(e) => set(i, { afterWeakAnswers: toNum(e.target.value) })} placeholder="any" className="input-field" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500">Score discount (0-1)</label>
              <input type="number" min={0} max={1} step={0.05} value={numVal(h.scoreDiscount)} onChange={(e) => set(i, { scoreDiscount: toNum(e.target.value) })} className="input-field" />
            </div>
          </div>
          {h.notBeforeMin === "" || h.notBeforeMin === undefined ? (
            h.afterWeakAnswers === "" || h.afterWeakAnswers === undefined ? (
              <p className="text-[11px] text-amber-600">No unlock condition: this hint is available from minute zero. Add a time or weak-answer gate.</p>
            ) : null
          ) : null}
        </div>
      ))}
      <AddButton onClick={() => onChange([...hints, { order: hints.length + 1, text: "", notBeforeMin: "", afterWeakAnswers: "", scoreDiscount: 0.1 }])}>Add hint</AddButton>
    </div>
  );
}

export function RubricEditor({ rubric, onChange }: { rubric: any[]; onChange: (r: any[]) => void }) {
  const set = (i: number, patch: any) => onChange(rubric.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      {rubric.map((r, i) => (
        <div key={i} className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600">Criterion {i + 1}</span>
            <RemoveButton onClick={() => onChange(rubric.filter((_, j) => j !== i))} />
          </div>
          <textarea value={r.text || ""} rows={2} onChange={(e) => set(i, { text: e.target.value })} placeholder="e.g. Identified the O(n^2) bottleneck in their own code" className="input-field" />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-gray-500">Id</label>
              <input value={r.id || ""} onChange={(e) => set(i, { id: e.target.value })} className="input-field font-mono text-xs" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500">Weight</label>
              <input type="number" min={0} step={0.5} value={numVal(r.weight)} onChange={(e) => set(i, { weight: toNum(e.target.value) })} className="input-field" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500">Maps to</label>
              <select value={r.mapsTo || "technicalDepth"} onChange={(e) => set(i, { mapsTo: e.target.value as Dimension })} className="input-field">
                {DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
      <AddButton onClick={() => onChange([...rubric, { id: `c${rubric.length + 1}`, text: "", weight: 1, mapsTo: "technicalDepth" }])}>Add criterion</AddButton>
    </div>
  );
}

export function NumberField({ label, value, onChange, min = 0, hint }: { label: string; value: any; onChange: (v: any) => void; min?: number; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" min={min} value={numVal(value)} onChange={(e) => onChange(toNum(e.target.value))} className="input-field" />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
