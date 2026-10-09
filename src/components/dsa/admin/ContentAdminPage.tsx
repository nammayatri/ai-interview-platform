"use client";

// Admin page for problems and puzzles: list, create, edit, archive, JSON import/export.
// Non-admins get the same page read-only (the API is the enforcement point).
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConfirmModal } from "@/components/ConfirmModal";
import { validateProblemRunbook, validatePuzzleRunbook } from "@/lib/runbook";
import { AddButton, HintLadderEditor, MarkdownField, NumberField, RemoveButton, RubricEditor, Section, StringListEditor } from "./fields";

type Kind = "parta" | "dsa" | "puzzle";

interface Item {
  id: string;
  title: string;
  difficulty: string | null;
  tags: string[];
  runbook: any;
  version: number;
  isArchived: boolean;
  expectedMin?: number;
}

interface Draft {
  title: string;
  difficulty: string;
  tags: string;
  runbook: any;
}

const emptyProblem = (): Draft => ({
  title: "",
  difficulty: "medium",
  tags: "",
  runbook: {
    statementMd: "",
    solutionTracks: [{ key: "", name: "", approach: "", timeComplexity: "", spaceComplexity: "", probes: [""] }],
    outcomeProbes: { passed: [""], partial: [""], failed: [""] },
    hintLadder: [],
    rubric: [{ id: "c1", text: "", weight: 1, mapsTo: "technicalDepth" }],
    defaults: { budgetMin: 15, graceMin: 2, earlyDoneAfterMin: 8 },
  },
});

const emptyPuzzle = (): Draft => ({
  title: "",
  difficulty: "medium",
  tags: "",
  runbook: {
    statementMd: "",
    acceptedAnswers: [""],
    expectedMin: 6,
    hintLadder: [],
    rubric: [{ id: "c1", text: "", weight: 1, mapsTo: "problemSolving" }],
  },
});

const COPY = {
  parta: {
    plural: "Part A Questions",
    singular: "Part A Question",
    blurb: "Questions whose solution the candidate wrote beforehand. You paste their submission when creating the interview and the AI evaluates it against this question's reference solutions.",
    path: "/api/problems",
    apiKind: "parta",
  },
  dsa: {
    plural: "DSA Problems",
    singular: "DSA Problem",
    blurb: "Problems solved live: the AI asks for the approach, then the candidate types the code in the scratchpad. Pick one per interview or let it choose at random.",
    path: "/api/problems",
    apiKind: "dsa",
  },
  puzzle: {
    plural: "Puzzles",
    singular: "Puzzle",
    blurb: "Reasoning puzzles with accepted answers, hints and a rubric. Pick one per interview or let it choose at random.",
    path: "/api/puzzles",
    apiKind: "",
  },
};

function toDraft(kind: Kind, item: Item): Draft {
  const base = kind !== "puzzle" ? emptyProblem() : emptyPuzzle();
  const rb = item.runbook || {};
  const merged = { ...base.runbook, ...rb };
  if (kind !== "puzzle") {
    merged.outcomeProbes = {
      passed: rb.outcomeProbes?.passed?.length ? rb.outcomeProbes.passed : [""],
      partial: rb.outcomeProbes?.partial?.length ? rb.outcomeProbes.partial : [""],
      failed: rb.outcomeProbes?.failed?.length ? rb.outcomeProbes.failed : [""],
    };
  }
  return { title: item.title, difficulty: item.difficulty || "", tags: (item.tags || []).join(", "), runbook: merged };
}

export function ContentAdminPage({ kind }: { kind: Kind }) {
  const copy = COPY[kind];
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Item | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`${copy.path}?archived=${showArchived}${copy.apiKind ? `&kind=${copy.apiKind}` : ""}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      console.error(`Failed to fetch ${copy.plural}`);
    } finally {
      setLoading(false);
    }
  }, [copy.path, copy.plural, showArchived]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const openCreate = () => { setEditing(null); setDraft(kind !== "puzzle" ? emptyProblem() : emptyPuzzle()); setErrors([]); setShowJson(false); setJsonText(""); };
  const openEdit = (item: Item) => { setEditing(item); setDraft(toDraft(kind, item)); setErrors([]); setShowJson(false); setJsonText(""); };
  const close = () => { setDraft(null); setEditing(null); };

  const setRunbook = (patch: any) => setDraft((d) => (d ? { ...d, runbook: { ...d.runbook, ...patch } } : d));

  const payloadOf = (d: Draft) => ({
    title: d.title.trim(),
    difficulty: d.difficulty || null,
    tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
    runbook: d.runbook,
    ...(copy.apiKind ? { kind: copy.apiKind } : {}),
  });

  const handleSave = async () => {
    if (!draft) return;
    const payload = payloadOf(draft);
    const local: string[] = [];
    if (!payload.title) local.push("title is required");
    const v = kind !== "puzzle" ? validateProblemRunbook(payload.runbook) : validatePuzzleRunbook(payload.runbook);
    if (!v.ok) local.push(...v.errors);
    if (!v.ok || local.length) { setErrors(local); return; }

    setSaving(true);
    try {
      const res = await fetch(editing ? `${copy.path}/${editing.id}` : copy.path, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, runbook: v.value }),
      });
      const data = await res.json();
      if (!res.ok) { setErrors(data.errors || [data.error || "Failed to save"]); return; }
      close();
      fetchItems();
    } catch {
      setErrors(["Network error while saving"]);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (item: Item) => {
    await fetch(`${copy.path}/${item.id}`, { method: "DELETE" });
    setArchiveTarget(null);
    fetchItems();
  };

  const restore = async (item: Item) => {
    await fetch(`${copy.path}/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: item.title, difficulty: item.difficulty, tags: item.tags, runbook: item.runbook, isArchived: false, ...(copy.apiKind ? { kind: copy.apiKind } : {}) }),
    });
    fetchItems();
  };

  const exportJson = () => {
    if (!draft) return;
    setJsonText(JSON.stringify(payloadOf(draft), null, 2));
    setShowJson(true);
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const hasEnvelope = parsed && typeof parsed === "object" && parsed.runbook;
      const base = kind !== "puzzle" ? emptyProblem() : emptyPuzzle();
      const runbook = hasEnvelope ? parsed.runbook : parsed;
      setDraft((d) => ({
        title: hasEnvelope && parsed.title ? String(parsed.title) : d?.title || "",
        difficulty: hasEnvelope && parsed.difficulty ? String(parsed.difficulty) : d?.difficulty || "medium",
        tags: hasEnvelope && Array.isArray(parsed.tags) ? parsed.tags.join(", ") : d?.tags || "",
        runbook: { ...base.runbook, ...runbook },
      }));
      setErrors([]);
      setShowJson(false);
    } catch {
      setErrors(["That is not valid JSON"]);
    }
  };

  const rb = draft?.runbook;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8 animate-fade-in-down">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{copy.plural}</h1>
            <p className="text-sm text-gray-500 mt-1">{copy.blurb}</p>
            {!isAdmin && <p className="text-xs text-amber-600 mt-1">Read-only: only admins can create or edit {copy.plural.toLowerCase()}.</p>}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
            </label>
            {isAdmin && <button onClick={openCreate} className="btn-primary">Create {copy.singular}</button>}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => <div key={i} className="card p-5"><div className="skeleton h-5 w-40 mb-3" /><div className="skeleton h-4 w-24" /></div>)}
          </div>
        ) : items.length === 0 ? (
          <div className="card p-16 text-center">
            <p className="text-xl font-semibold text-gray-900 mb-2">No {copy.plural.toLowerCase()} yet</p>
            <p className="text-gray-500 max-w-md mx-auto">{isAdmin ? `Create one, or paste a runbook as JSON from the editor.` : `An admin needs to add some before DSA Review interviews can be created.`}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <div key={item.id} className={`card-hover p-5 ${item.isArchived ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-base font-semibold text-gray-900 truncate">{item.title}</h3>
                  <span className="text-[10px] text-gray-400 shrink-0">v{item.version}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  {item.difficulty && <span className="badge-info capitalize">{item.difficulty}</span>}
                  {item.isArchived && <span className="badge-warning">archived</span>}
                  {item.tags.slice(0, 3).map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{t}</span>)}
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  {kind !== "puzzle"
                    ? `${item.runbook?.solutionTracks?.length ?? 0} tracks · ${item.runbook?.hintLadder?.length ?? 0} hints · ${item.runbook?.rubric?.length ?? 0} criteria`
                    : `~${item.expectedMin ?? item.runbook?.expectedMin} min · ${item.runbook?.hintLadder?.length ?? 0} hints · ${item.runbook?.rubric?.length ?? 0} criteria`}
                </p>
                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  <button onClick={() => openEdit(item)} className="text-xs text-indigo-600 hover:text-indigo-800">{isAdmin ? "Edit" : "View"}</button>
                  {isAdmin && (item.isArchived
                    ? <button onClick={() => restore(item)} className="text-xs text-green-600 hover:text-green-800">Restore</button>
                    : <button onClick={() => setArchiveTarget(item)} className="text-xs text-red-500 hover:text-red-700">Archive</button>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {draft && rb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={close} />
          <div className="relative w-full max-w-3xl card p-0 max-h-[90vh] overflow-hidden animate-scale-in flex flex-col">
            <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{editing ? (isAdmin ? `Edit ${copy.singular}` : copy.singular) : `Create ${copy.singular}`}</h2>
                {editing && <p className="text-xs text-gray-500 mt-0.5">Version {editing.version}. Saving creates version {editing.version + 1}; interviews already created keep their snapshot.</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={exportJson} className="btn-secondary !py-1.5 !px-3 text-xs">JSON</button>
              </div>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1">
              {showJson && (
                <div className="mb-4 space-y-2">
                  <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={12} className="input-field font-mono text-xs" placeholder='Paste {"title": "...", "runbook": {...}} or a bare runbook' />
                  <div className="flex gap-2">
                    {isAdmin && <button type="button" onClick={importJson} className="btn-primary !py-1.5 text-xs">Load into form</button>}
                    <button type="button" onClick={() => navigator.clipboard?.writeText(jsonText)} className="btn-secondary !py-1.5 text-xs">Copy</button>
                    <button type="button" onClick={() => setShowJson(false)} className="btn-secondary !py-1.5 text-xs">Hide</button>
                  </div>
                </div>
              )}
              {!showJson && isAdmin && <button type="button" onClick={() => { setJsonText(""); setShowJson(true); }} className="text-xs text-indigo-600 mb-4 block">Paste runbook JSON to import</button>}

              <fieldset disabled={!isAdmin} className="space-y-5 min-w-0">
                <Section title="Basics">
                  <div>
                    <label className="label">Title</label>
                    <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="input-field" placeholder={kind === "puzzle" ? "e.g. Two ropes, 45 minutes" : kind === "parta" ? "e.g. Locking tree: lock, unlock, upgrade" : "e.g. Two Sum"} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Difficulty</label>
                      <select value={draft.difficulty} onChange={(e) => setDraft({ ...draft, difficulty: e.target.value })} className="input-field">
                        <option value="">Unspecified</option>
                        <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Tags</label>
                      <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} className="input-field" placeholder="arrays, hashing" />
                    </div>
                  </div>
                  <MarkdownField label="Statement (markdown)" value={rb.statementMd} onChange={(v) => setRunbook({ statementMd: v })} hint={kind === "puzzle" ? "Keep it prose-first: the AI reads this aloud once." : undefined} />
                </Section>

                {kind !== "puzzle" ? (
                  <>
                    <Section title="Reference solutions" subtitle="Each approach with its complexity and the probes to use when the candidate is on that track, from brute force up to the best one (list the best last). Never shown to the candidate.">
                      {rb.solutionTracks.map((t: any, i: number) => {
                        const set = (patch: any) => setRunbook({ solutionTracks: rb.solutionTracks.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
                        return (
                          <div key={i} className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
                            <div className="flex gap-2 items-center">
                              <input value={t.name} onChange={(e) => set({ name: e.target.value })} className="input-field" placeholder="Track name, e.g. Hash map" />
                              <RemoveButton onClick={() => setRunbook({ solutionTracks: rb.solutionTracks.filter((_: any, j: number) => j !== i) })} />
                            </div>
                            <textarea value={t.approach} onChange={(e) => set({ approach: e.target.value })} rows={2} className="input-field" placeholder="What this approach does (markdown)" />
                            <div className="grid grid-cols-2 gap-2">
                              <input value={t.timeComplexity} onChange={(e) => set({ timeComplexity: e.target.value })} className="input-field" placeholder="Time, e.g. O(n)" />
                              <input value={t.spaceComplexity} onChange={(e) => set({ spaceComplexity: e.target.value })} className="input-field" placeholder="Space, e.g. O(n)" />
                            </div>
                            <StringListEditor label="Probes for this track" items={t.probes?.length ? t.probes : [""]} onChange={(probes) => set({ probes })} placeholder="A question to ask" />
                          </div>
                        );
                      })}
                      <AddButton onClick={() => setRunbook({ solutionTracks: [...rb.solutionTracks, { key: "", name: "", approach: "", timeComplexity: "", spaceComplexity: "", probes: [""] }] })}>Add track</AddButton>
                    </Section>

                    {kind === "parta" && <Section title="Probes about the candidate's code" subtitle="The AI reads the code and uses the group that matches what it sees.">
                      {(["passed", "partial", "failed"] as const).map((o) => (
                        <StringListEditor key={o} label={o === "passed" ? "If the code works and is correct" : o === "partial" ? "If the code works only partly" : "If the code does not work or does not run"} items={rb.outcomeProbes[o]} onChange={(list) => setRunbook({ outcomeProbes: { ...rb.outcomeProbes, [o]: list } })} placeholder="A probe question" />
                      ))}
                    </Section>}
                  </>
                ) : (
                  <Section title="Answers and timing">
                    <StringListEditor label="Accepted answers" items={rb.acceptedAnswers} onChange={(acceptedAnswers) => setRunbook({ acceptedAnswers })} placeholder="Short answer, judged by the AI (not string-matched)" />
                    <NumberField label="Expected minutes" min={1} value={rb.expectedMin} onChange={(expectedMin) => setRunbook({ expectedMin })} hint="Used to decide whether the puzzle fits in the remaining time." />
                  </Section>
                )}

                <Section title="Hint ladder" subtitle="Ordered nudges. Only the next unlocked hint is ever visible to the AI; each use reduces the phase score by its discount.">
                  <HintLadderEditor hints={rb.hintLadder} onChange={(hintLadder) => setRunbook({ hintLadder })} />
                </Section>

                <Section title="Rubric" subtitle="Criteria are scored met / partial / missed and rolled into the five scorecard dimensions by weight.">
                  <RubricEditor rubric={rb.rubric} onChange={(rubric) => setRunbook({ rubric })} />
                </Section>

                {kind !== "puzzle" && (
                  <Section title="Time defaults" subtitle="Prefilled when an interviewer creates a DSA Review interview with this problem.">
                    <div className="grid grid-cols-3 gap-3">
                      <NumberField label="DSA budget (min)" min={1} value={rb.defaults.budgetMin} onChange={(v) => setRunbook({ defaults: { ...rb.defaults, budgetMin: v } })} />
                      <NumberField label="Grace (min)" value={rb.defaults.graceMin} onChange={(v) => setRunbook({ defaults: { ...rb.defaults, graceMin: v } })} />
                      <NumberField label="Early done after (min)" value={rb.defaults.earlyDoneAfterMin} onChange={(v) => setRunbook({ defaults: { ...rb.defaults, earlyDoneAfterMin: v } })} />
                    </div>
                  </Section>
                )}
              </fieldset>

              {errors.length > 0 && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 space-y-0.5" role="alert">
                  {errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={close} className="btn-secondary">{isAdmin ? "Cancel" : "Close"}</button>
              {isAdmin && <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? "Saving..." : editing ? "Save new version" : `Create ${copy.singular}`}</button>}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!archiveTarget}
        title={`Archive ${copy.singular}`}
        message={`Archive "${archiveTarget?.title}"? It will no longer be offered for new interviews. Existing interviews are unaffected.`}
        confirmLabel="Archive"
        onConfirm={() => archiveTarget && handleArchive(archiveTarget)}
        onCancel={() => setArchiveTarget(null)}
      />
    </DashboardLayout>
  );
}
