"use client";

// Interview stage builder for the coding evaluation: Part A (the candidate's own solution), a live DSA problem,
// and a puzzle. Each stage can be switched on or off and reordered, has its own time, picks a specific item or a
// random one, and plugs in an interview runbook.
import { BUILTIN_RUNBOOKS, CLOSE_RESERVE_MIN, LIMITS, STAGE_KEYS, STAGE_LABELS, type StageKey } from "@/lib/runbook";

/** Part A only needs the candidate's code; the AI works out what it does and whether it is right. */
export interface SubmissionForm {
  code: string;
}

export interface StageState {
  key: StageKey;
  enabled: boolean;
  budgetMin: number;
  graceMin: number;
  earlyDoneAfterMin: number;
  mode: "specific" | "random";
  itemId: string;
  runbookId: string;
  /** set once the interviewer edits the time, so picking an item no longer overwrites it */
  timeTouched: boolean;
}

export interface StagesForm {
  /** Always the three stages; the array order is the order they run in. */
  stages: StageState[];
  submission: SubmissionForm;
}

export interface ItemOption { id: string; title: string; difficulty: string | null; runbook: { defaults?: { budgetMin: number; graceMin: number; earlyDoneAfterMin: number }; expectedMin?: number } }
export interface RunbookOption { id: string; kind: StageKey; name: string; description: string }

export const emptySubmission = (): SubmissionForm => ({ code: "" });

export const emptyStagesForm = (): StagesForm => ({
  stages: [
    { key: "parta", enabled: true, budgetMin: 20, graceMin: 3, earlyDoneAfterMin: 10, mode: "specific", itemId: "", runbookId: "", timeTouched: false },
    { key: "dsa", enabled: true, budgetMin: 20, graceMin: 3, earlyDoneAfterMin: 10, mode: "random", itemId: "", runbookId: "", timeTouched: false },
    { key: "puzzle", enabled: true, budgetMin: 8, graceMin: 0, earlyDoneAfterMin: 0, mode: "random", itemId: "", runbookId: "", timeTouched: false },
  ],
  submission: emptySubmission(),
});

/** Total interview time: every enabled stage's time plus the closing reserve. */
export function computeDuration(f: StagesForm): number {
  const total = f.stages.filter((s) => s.enabled).reduce((n, s) => n + s.budgetMin, 0) + CLOSE_RESERVE_MIN;
  return Math.max(5, Math.min(180, total));
}

export function stagesFormError(f: StagesForm): string | null {
  const on = f.stages.filter((s) => s.enabled);
  if (on.length === 0) return "Turn on at least one stage";
  for (const s of on) {
    if (!(s.budgetMin >= 1)) return `${STAGE_LABELS[s.key]}: set a time of at least 1 minute`;
    if (s.earlyDoneAfterMin > s.budgetMin) return `${STAGE_LABELS[s.key]}: "can finish early after" cannot exceed its time`;
    if (s.mode === "specific" && !s.itemId) return `${STAGE_LABELS[s.key]}: pick ${s.key === "parta" ? "the Part A question" : s.key === "dsa" ? "a DSA problem" : "a puzzle"}, or choose random`;
  }
  if (on.some((s) => s.key === "parta")) {
    if (!f.submission.code.trim()) return "Part A: paste the candidate's submitted code";
  }
  if (computeDuration(f) > 180) return "The stage times add up to more than 3 hours";
  return null;
}

/** Fields appended to the create-interview multipart body. */
export function stagesFormFields(f: StagesForm): Record<string, string> {
  const on = f.stages.filter((s) => s.enabled);
  const fields: Record<string, string> = {
    stages: JSON.stringify(
      on.map((s) => ({
        key: s.key,
        budgetMin: s.budgetMin,
        graceMin: s.graceMin,
        earlyDoneAfterMin: s.key === "puzzle" ? null : s.earlyDoneAfterMin,
        mode: s.key === "parta" ? "specific" : s.mode,
        itemId: s.mode === "specific" || s.key === "parta" ? s.itemId : null,
        runbookId: s.runbookId || null,
      }))
    ),
  };
  if (on.some((s) => s.key === "parta")) fields.partaSubmission = JSON.stringify({ code: f.submission.code });
  return fields;
}

const BLURB: Record<StageKey, string> = {
  parta: "The AI evaluates the candidate's own submission against the Part A question's runbook: function by function, complexity, then asks for an optimized approach.",
  dsa: "A fresh problem. The AI asks for the approach, then the candidate types the code in the scratchpad.",
  puzzle: "A reasoning puzzle. The AI lets the candidate reason aloud and probes the answer.",
};

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-indigo-600" : "bg-gray-300"}`}>
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

function SubmissionFields({ value, onChange }: { value: SubmissionForm; onChange: (v: SubmissionForm) => void }) {
  return (
    <div className="space-y-2 rounded-xl bg-gray-50 border border-gray-200 p-4">
      <label className="label !mb-0">Candidate&apos;s code <span className="text-red-400">*</span> <span className="text-gray-400 font-normal">({value.code.length.toLocaleString()} / {LIMITS.codeChars.toLocaleString()})</span></label>
      <textarea value={value.code} onChange={(e) => onChange({ code: e.target.value.slice(0, LIMITS.codeChars) })} rows={14} spellCheck={false} className="input-field font-mono text-xs" placeholder="Paste the code the candidate wrote for the Part A question" />
    </div>
  );
}

export function StageBuilder({ form, onChange, partaQuestions, dsaProblems, puzzles, runbooks, startStep }: {
  form: StagesForm; onChange: (f: StagesForm) => void;
  partaQuestions: ItemOption[]; dsaProblems: ItemOption[]; puzzles: ItemOption[]; runbooks: RunbookOption[]; startStep: number;
}) {
  const update = (key: StageKey, patch: Partial<StageState>) =>
    onChange({ ...form, stages: form.stages.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= form.stages.length) return;
    const next = form.stages.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...form, stages: next });
  };

  const optionsFor = (key: StageKey) => (key === "parta" ? partaQuestions : key === "dsa" ? dsaProblems : puzzles);

  const pickItem = (s: StageState, id: string) => {
    const it = optionsFor(s.key).find((x) => x.id === id);
    const d = it?.runbook.defaults;
    const patch: Partial<StageState> = { itemId: id };
    if (!s.timeTouched && it) {
      if (d) Object.assign(patch, { budgetMin: d.budgetMin, graceMin: d.graceMin, earlyDoneAfterMin: Math.min(d.earlyDoneAfterMin, d.budgetMin) });
      else if (it.runbook.expectedMin) patch.budgetMin = it.runbook.expectedMin;
    }
    update(s.key, patch);
  };

  const total = computeDuration(form);
  const error = stagesFormError(form);

  return (
    <div className="card p-6 border-l-4 border-l-amber-500 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{startStep}</div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Stages</h3>
          <p className="text-xs text-gray-500 mt-0.5">Switch stages on or off, reorder them, and give each its own time. Each stage uses a runbook that tells the AI how to ask.</p>
        </div>
      </div>

      <ol className="space-y-4">
        {form.stages.map((s, i) => {
          const items = optionsFor(s.key);
          const kindRunbooks = runbooks.filter((r) => r.kind === s.key);
          return (
            <li key={s.key} className={`rounded-xl border p-4 transition ${s.enabled ? "border-indigo-200 bg-white" : "border-gray-200 bg-gray-50 opacity-70"}`}>
              <div className="flex items-start gap-3">
                <Toggle on={s.enabled} onChange={(v) => update(s.key, { enabled: v })} label={`Include ${STAGE_LABELS[s.key]}`} />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-gray-900">{STAGE_LABELS[s.key]}</h4>
                  <p className="text-xs text-gray-500">{BLURB[s.key]}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === form.stages.length - 1} aria-label="Move down" className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30">↓</button>
                </div>
              </div>

              {s.enabled && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className="label">Time (min)</label><input type="number" min={1} value={s.budgetMin} onChange={(e) => update(s.key, { budgetMin: Math.max(0, Number(e.target.value) || 0), timeTouched: true })} className="input-field" /></div>
                    <div><label className="label">Grace (min)</label><input type="number" min={0} value={s.graceMin} onChange={(e) => update(s.key, { graceMin: Math.max(0, Number(e.target.value) || 0), timeTouched: true })} className="input-field" /></div>
                    {s.key !== "puzzle" && <div><label className="label">Can finish early after (min)</label><input type="number" min={0} value={s.earlyDoneAfterMin} onChange={(e) => update(s.key, { earlyDoneAfterMin: Math.max(0, Number(e.target.value) || 0), timeTouched: true })} className="input-field" /></div>}
                  </div>

                  {s.key !== "parta" && (
                    <div className="flex items-center gap-5 text-xs text-gray-700">
                      <label className="flex items-center gap-1.5"><input type="radio" checked={s.mode === "specific"} onChange={() => update(s.key, { mode: "specific" })} /> Pick one</label>
                      <label className="flex items-center gap-1.5"><input type="radio" checked={s.mode === "random"} onChange={() => update(s.key, { mode: "random" })} /> Random from all ({items.length})</label>
                    </div>
                  )}

                  {(s.key === "parta" || s.mode === "specific") && (
                    <div>
                      <label className="label">{s.key === "parta" ? "Part A question" : s.key === "dsa" ? "DSA problem" : "Puzzle"} <span className="text-red-400">*</span></label>
                      {items.length === 0 ? (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          Nothing here yet. An admin needs to add {s.key === "parta" ? "a Part A question on the Part A Questions page" : s.key === "dsa" ? "a problem on the DSA Problems page" : "a puzzle on the Puzzles page"}.
                        </p>
                      ) : (
                        <select value={s.itemId} onChange={(e) => pickItem(s, e.target.value)} className="input-field">
                          <option value="">Select...</option>
                          {items.map((x) => <option key={x.id} value={x.id}>{x.title}{x.difficulty ? ` (${x.difficulty})` : ""}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                  {s.key !== "parta" && s.mode === "random" && items.length === 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">There is nothing to pick from at random yet.</p>
                  )}

                  <div>
                    <label className="label">Runbook <span className="text-gray-400 font-normal">(how the AI asks)</span></label>
                    <select value={s.runbookId} onChange={(e) => update(s.key, { runbookId: e.target.value })} className="input-field">
                      <option value="">{BUILTIN_RUNBOOKS[s.key].name} (built-in)</option>
                      {kindRunbooks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {s.runbookId ? kindRunbooks.find((r) => r.id === s.runbookId)?.description : BUILTIN_RUNBOOKS[s.key].description}{" "}
                      <a href="/runbooks" target="_blank" rel="noreferrer" className="text-indigo-600 underline">Manage runbooks</a>
                    </p>
                  </div>

                  {s.key === "parta" && <SubmissionFields value={form.submission} onChange={(submission) => onChange({ ...form, submission })} />}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
        <span>Total interview time: <strong>{total} min</strong> <span className="text-indigo-600/80">(stages {total - CLOSE_RESERVE_MIN} + {CLOSE_RESERVE_MIN} min to close)</span></span>
        <span className="text-xs text-indigo-700">{form.stages.filter((s) => s.enabled).map((s) => STAGE_LABELS[s.key]).join(" → ") || "No stages"}</span>
      </div>
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

export { STAGE_KEYS };
