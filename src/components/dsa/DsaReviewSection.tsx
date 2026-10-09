"use client";

// "DSA Review" part of the create-interview form: primary problem, HackerRank submissions,
// puzzle pool and phase plan. State lives in the page; this component renders and edits it.
import { CLOSE_RESERVE_MIN, LIMITS } from "@/lib/runbook";
import { AddButton, RemoveButton } from "./admin/fields";

export interface SubmissionForm {
  problemTitle: string;
  language: string;
  code: string;
  outcome: "passed" | "partial" | "failed";
  score: string;
  testsPassed: string;
  testsTotal: string;
  externalUrl: string;
  notes: string;
}

export interface DsaFormState {
  primaryProblemId: string;
  primary: SubmissionForm;
  extras: SubmissionForm[];
  puzzleIds: string[];
  plan: { dsaBudgetMin: number; graceMin: number; earlyDoneAfterMin: number; puzzleMinRemainingMin: number; puzzleSelection: "random" | "ordered" };
  planTouched: boolean;
  minRemainingTouched: boolean;
}

export interface ProblemOption { id: string; title: string; difficulty: string | null; runbook: { defaults: { budgetMin: number; graceMin: number; earlyDoneAfterMin: number } } }
export interface PuzzleOption { id: string; title: string; difficulty: string | null; expectedMin?: number; runbook: { expectedMin: number } }

export const emptySubmission = (): SubmissionForm => ({ problemTitle: "", language: "", code: "", outcome: "passed", score: "", testsPassed: "", testsTotal: "", externalUrl: "", notes: "" });

export const emptyDsaForm = (): DsaFormState => ({
  primaryProblemId: "",
  primary: emptySubmission(),
  extras: [],
  puzzleIds: [],
  plan: { dsaBudgetMin: 15, graceMin: 2, earlyDoneAfterMin: 8, puzzleMinRemainingMin: 5, puzzleSelection: "random" },
  planTouched: false,
  minRemainingTouched: false,
});

const numOrNull = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

export function dsaFormError(s: DsaFormState, duration: number): string | null {
  if (!s.primaryProblemId) return "Pick the primary problem";
  if (!s.primary.code.trim()) return "Paste the candidate's submitted code";
  const p = s.plan;
  if (p.dsaBudgetMin + p.graceMin + CLOSE_RESERVE_MIN > duration) {
    return `DSA budget + grace + ${CLOSE_RESERVE_MIN} min closing reserve must fit within the ${duration} minute duration`;
  }
  if (p.earlyDoneAfterMin > p.dsaBudgetMin) return "Early-done threshold cannot exceed the DSA budget";
  const bad = [s.primary, ...s.extras].find((x) => {
    const tp = numOrNull(x.testsPassed), tt = numOrNull(x.testsTotal);
    return tp !== null && tt !== null && tp > tt;
  });
  if (bad) return "Tests passed cannot exceed tests total";
  const extraMissing = s.extras.find((x) => !x.problemTitle.trim() || !x.code.trim());
  if (extraMissing) return "Each extra submission needs a problem title and code (or remove it)";
  return null;
}

/** Fields appended to the create-interview multipart body. */
export function dsaFormFields(s: DsaFormState, problems: ProblemOption[]): Record<string, string> {
  const title = problems.find((p) => p.id === s.primaryProblemId)?.title || "";
  const toSubmission = (x: SubmissionForm, isPrimary: boolean) => ({
    problemTitle: isPrimary ? title : x.problemTitle.trim(),
    language: x.language.trim(),
    code: x.code,
    outcome: x.outcome,
    score: numOrNull(x.score),
    testsPassed: numOrNull(x.testsPassed),
    testsTotal: numOrNull(x.testsTotal),
    externalUrl: x.externalUrl.trim(),
    notes: x.notes.trim(),
    isPrimary,
  });
  return {
    primaryProblemId: s.primaryProblemId,
    submissions: JSON.stringify([toSubmission(s.primary, true), ...s.extras.map((x) => toSubmission(x, false))]),
    puzzleIds: JSON.stringify(s.puzzleIds),
    plan: JSON.stringify(s.plan),
  };
}

function SubmissionFields({ value, onChange, showTitle }: { value: SubmissionForm; onChange: (v: SubmissionForm) => void; showTitle?: boolean }) {
  const set = (patch: Partial<SubmissionForm>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      {showTitle && (
        <div>
          <label className="label">Problem title</label>
          <input value={value.problemTitle} onChange={(e) => set({ problemTitle: e.target.value })} className="input-field" placeholder="e.g. Longest Substring Without Repeating Characters" />
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="label">Outcome</label>
          <select value={value.outcome} onChange={(e) => set({ outcome: e.target.value as SubmissionForm["outcome"] })} className="input-field">
            <option value="passed">Passed</option><option value="partial">Partial</option><option value="failed">Failed</option>
          </select>
        </div>
        <div><label className="label">Language</label><input value={value.language} onChange={(e) => set({ language: e.target.value })} className="input-field" placeholder="Python" /></div>
        <div><label className="label">Score</label><input type="number" value={value.score} onChange={(e) => set({ score: e.target.value })} className="input-field" placeholder="100" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Tests</label><input type="number" min={0} value={value.testsPassed} onChange={(e) => set({ testsPassed: e.target.value })} className="input-field" placeholder="9" /></div>
          <div><label className="label">of</label><input type="number" min={0} value={value.testsTotal} onChange={(e) => set({ testsTotal: e.target.value })} className="input-field" placeholder="12" /></div>
        </div>
      </div>
      <div>
        <label className="label">Code <span className="text-gray-400 font-normal">({value.code.length.toLocaleString()} / {LIMITS.codeChars.toLocaleString()})</span></label>
        <textarea value={value.code} onChange={(e) => set({ code: e.target.value.slice(0, LIMITS.codeChars) })} rows={10} className="input-field font-mono text-xs" placeholder="Paste the submitted code" spellCheck={false} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label">HackerRank link</label><input value={value.externalUrl} onChange={(e) => set({ externalUrl: e.target.value })} className="input-field" placeholder="https://www.hackerrank.com/..." /></div>
        <div><label className="label">Notes</label><input value={value.notes} onChange={(e) => set({ notes: e.target.value })} className="input-field" placeholder="Anything the AI should know about this submission" /></div>
      </div>
    </div>
  );
}

export function DsaReviewSection({ state, onChange, problems, puzzles, duration, startStep }: {
  state: DsaFormState; onChange: (s: DsaFormState) => void; problems: ProblemOption[]; puzzles: PuzzleOption[]; duration: number; startStep: number;
}) {
  const set = (patch: Partial<DsaFormState>) => onChange({ ...state, ...patch });

  const chooseProblem = (id: string) => {
    const p = problems.find((x) => x.id === id);
    if (p && !state.planTouched) {
      const d = p.runbook.defaults;
      set({ primaryProblemId: id, plan: { ...state.plan, dsaBudgetMin: d.budgetMin, graceMin: d.graceMin, earlyDoneAfterMin: d.earlyDoneAfterMin } });
    } else set({ primaryProblemId: id });
  };

  const togglePuzzle = (id: string) => {
    const puzzleIds = state.puzzleIds.includes(id) ? state.puzzleIds.filter((x) => x !== id) : [...state.puzzleIds, id];
    const mins = puzzleIds.map((pid) => puzzles.find((p) => p.id === pid)?.runbook.expectedMin).filter((n): n is number => typeof n === "number");
    const plan = !state.minRemainingTouched && mins.length ? { ...state.plan, puzzleMinRemainingMin: Math.min(...mins) } : state.plan;
    set({ puzzleIds, plan });
  };

  const setPlan = (patch: Partial<DsaFormState["plan"]>, key?: "minRemaining") =>
    set({ plan: { ...state.plan, ...patch }, planTouched: true, ...(key === "minRemaining" ? { minRemainingTouched: true } : {}) });

  const error = dsaFormError(state, duration);
  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <div className="card p-6 border-l-4 border-l-amber-500 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{startStep}</div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">DSA Review</h3>
          <p className="text-xs text-gray-500 mt-0.5">The AI will discuss the candidate&apos;s own HackerRank submission, then optionally a puzzle. The candidate does not write code.</p>
        </div>
      </div>

      <div>
        <label className="label">Primary problem <span className="text-red-400">*</span></label>
        {problems.length === 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No problems yet. An admin needs to add one on the Problems page.</p>
        ) : (
          <select value={state.primaryProblemId} onChange={(e) => chooseProblem(e.target.value)} className="input-field">
            <option value="">Select the problem the candidate solved...</option>
            {problems.map((p) => <option key={p.id} value={p.id}>{p.title}{p.difficulty ? ` (${p.difficulty})` : ""}</option>)}
          </select>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Primary submission</h4>
        <SubmissionFields value={state.primary} onChange={(primary) => set({ primary })} />
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Other submissions <span className="font-normal normal-case">(context only, optional)</span></h4>
        <div className="space-y-4">
          {state.extras.map((x, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3">
              <div className="flex justify-end"><RemoveButton onClick={() => set({ extras: state.extras.filter((_, j) => j !== i) })} /></div>
              <SubmissionFields showTitle value={x} onChange={(v) => set({ extras: state.extras.map((e, j) => (j === i ? v : e)) })} />
            </div>
          ))}
          <AddButton onClick={() => set({ extras: [...state.extras, emptySubmission()] })}>Add another submission</AddButton>
        </div>
      </div>

      <div>
        <label className="label">Puzzle pool <span className="text-gray-400 font-normal">(the server picks one that fits the remaining time)</span></label>
        {puzzles.length === 0 ? (
          <p className="text-xs text-gray-500">No puzzles available. The interview will go straight to wrap-up after the DSA discussion.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {puzzles.map((p) => (
              <button key={p.id} type="button" onClick={() => togglePuzzle(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${state.puzzleIds.includes(p.id) ? "bg-indigo-600 text-white" : "bg-gray-50 text-gray-600 border border-gray-200 hover:border-indigo-200"}`}>
                {p.title} · ~{p.runbook.expectedMin}m
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Phase plan</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="label">DSA budget (min)</label><input type="number" min={1} value={state.plan.dsaBudgetMin} onChange={(e) => setPlan({ dsaBudgetMin: num(e.target.value) })} className="input-field" /></div>
          <div><label className="label">Grace (min)</label><input type="number" min={0} value={state.plan.graceMin} onChange={(e) => setPlan({ graceMin: num(e.target.value) })} className="input-field" /></div>
          <div><label className="label">Early done after (min)</label><input type="number" min={0} value={state.plan.earlyDoneAfterMin} onChange={(e) => setPlan({ earlyDoneAfterMin: num(e.target.value) })} className="input-field" /></div>
          <div><label className="label">Puzzle needs (min left)</label><input type="number" min={0} value={state.plan.puzzleMinRemainingMin} onChange={(e) => setPlan({ puzzleMinRemainingMin: num(e.target.value) }, "minRemaining")} className="input-field" /></div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-600">
          <label className="flex items-center gap-1.5"><input type="radio" checked={state.plan.puzzleSelection === "random"} onChange={() => setPlan({ puzzleSelection: "random" })} /> Random puzzle</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={state.plan.puzzleSelection === "ordered"} onChange={() => setPlan({ puzzleSelection: "ordered" })} /> First that fits (in selected order)</label>
        </div>
        <p className="text-xs text-gray-400 mt-2">The last {CLOSE_RESERVE_MIN} minutes are reserved for closing. The puzzle only runs if enough time remains after the DSA phase.</p>
      </div>

      {error && state.primaryProblemId && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}
