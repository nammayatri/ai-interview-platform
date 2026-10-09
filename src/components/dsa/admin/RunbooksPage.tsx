"use client";

// Library of interview runbooks ("how the AI asks questions"), one tab per stage type.
// The built-in defaults are shown read-only; duplicate one to customize it. Admins create, edit and archive.
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConfirmModal } from "@/components/ConfirmModal";
import { BUILTIN_RUNBOOKS, STAGE_KEYS, STAGE_LABELS, validateInterviewRunbook, type StageKey } from "@/lib/runbook";
import { RubricEditor, Section, StringListEditor } from "./fields";

interface Runbook {
  id: string;
  kind: StageKey;
  name: string;
  description: string;
  instructions: string;
  probes: string[];
  rubric: any[];
  version: number;
  isArchived: boolean;
}

interface Draft { name: string; description: string; instructions: string; probes: string[]; rubric: any[] }

const TAB_BLURB: Record<StageKey, string> = {
  parta: "How the AI evaluates the candidate's own solution: what to ask about their code, how to ask complexity, when to ask for pseudocode.",
  dsa: "How the AI runs a live problem: understanding, approach, improvement, then code in the scratchpad.",
  puzzle: "How the AI runs a puzzle: how much to let the candidate reason and how to probe an answer.",
};

const draftOf = (r: { name: string; description: string; instructions: string; probes: string[]; rubric: any[] }): Draft => ({
  name: r.name, description: r.description, instructions: r.instructions, probes: r.probes.length ? r.probes : [""], rubric: r.rubric,
});

export function RunbooksPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";
  const [tab, setTab] = useState<StageKey>("parta");
  const [items, setItems] = useState<Runbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Runbook | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewBuiltin, setViewBuiltin] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Runbook | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/runbooks?kind=${tab}&archived=${showArchived}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [tab, showArchived]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const close = () => { setDraft(null); setEditing(null); setViewBuiltin(false); setErrors([]); };
  const openCreate = () => { setEditing(null); setViewBuiltin(false); setDraft({ name: "", description: "", instructions: "", probes: [""], rubric: [] }); setErrors([]); };
  const openEdit = (r: Runbook) => { setEditing(r); setViewBuiltin(false); setDraft(draftOf(r)); setErrors([]); };
  const duplicateBuiltin = () => { setEditing(null); setViewBuiltin(false); setDraft(draftOf({ ...BUILTIN_RUNBOOKS[tab], name: `${BUILTIN_RUNBOOKS[tab].name} (copy)` })); setErrors([]); };
  const showBuiltin = () => { setEditing(null); setViewBuiltin(true); setDraft(draftOf(BUILTIN_RUNBOOKS[tab])); setErrors([]); };

  const save = async () => {
    if (!draft) return;
    const payload = { ...draft, probes: draft.probes.map((p) => p.trim()).filter(Boolean), kind: tab };
    const v = validateInterviewRunbook(payload);
    if (!v.ok) { setErrors(v.errors); return; }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/runbooks/${editing.id}` : "/api/runbooks", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v.value, kind: tab }),
      });
      const data = await res.json();
      if (!res.ok) { setErrors(data.errors || [data.error || "Failed to save"]); return; }
      close();
      load();
    } catch {
      setErrors(["Network error while saving"]);
    } finally {
      setSaving(false);
    }
  };

  const archive = async (r: Runbook) => {
    await fetch(`/api/runbooks/${r.id}`, { method: "DELETE" });
    setArchiveTarget(null);
    load();
  };
  const restore = async (r: Runbook) => {
    await fetch(`/api/runbooks/${r.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, isArchived: false }) });
    load();
  };

  const readOnly = viewBuiltin || !isAdmin;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-6 animate-fade-in-down">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Runbooks</h1>
            <p className="text-sm text-gray-500 mt-1">How the AI asks its questions. Create as many as you like for each stage and plug one into a stage when you create an interview.</p>
            {!isAdmin && <p className="text-xs text-amber-600 mt-1">Read-only: only admins can create or edit runbooks.</p>}
          </div>
          {isAdmin && <button onClick={openCreate} className="btn-primary shrink-0">Create runbook</button>}
        </div>

        <div className="flex gap-1 border-b border-gray-200 mb-4">
          {STAGE_KEYS.map((k) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === k ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              {STAGE_LABELS[k]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 pb-2">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        </div>
        <p className="text-sm text-gray-500 mb-4">{TAB_BLURB[tab]}</p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="card p-5 border-dashed">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-gray-900">{BUILTIN_RUNBOOKS[tab].name}</h3>
              <span className="badge-info">built-in</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">{BUILTIN_RUNBOOKS[tab].description}</p>
            <p className="text-[11px] text-gray-400 mb-3">Used when a stage has no runbook selected.</p>
            <div className="flex gap-3 pt-3 border-t border-gray-100">
              <button onClick={showBuiltin} className="text-xs text-indigo-600 hover:text-indigo-800">View</button>
              {isAdmin && <button onClick={duplicateBuiltin} className="text-xs text-indigo-600 hover:text-indigo-800">Duplicate to customize</button>}
            </div>
          </div>

          {loading
            ? [1, 2].map((i) => <div key={i} className="card p-5"><div className="skeleton h-5 w-40 mb-3" /><div className="skeleton h-4 w-24" /></div>)
            : items.map((r) => (
                <div key={r.id} className={`card-hover p-5 ${r.isArchived ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-base font-semibold text-gray-900 truncate">{r.name}</h3>
                    <span className="text-[10px] text-gray-400 shrink-0">v{r.version}</span>
                  </div>
                  {r.isArchived && <span className="badge-warning mb-2">archived</span>}
                  <p className="text-xs text-gray-500 mb-3 line-clamp-3">{r.description || r.instructions}</p>
                  <p className="text-[11px] text-gray-400 mb-3">{r.probes.length} extra probes · {r.rubric.length} extra criteria</p>
                  <div className="flex gap-3 pt-3 border-t border-gray-100">
                    <button onClick={() => openEdit(r)} className="text-xs text-indigo-600 hover:text-indigo-800">{isAdmin ? "Edit" : "View"}</button>
                    {isAdmin && (r.isArchived
                      ? <button onClick={() => restore(r)} className="text-xs text-green-600 hover:text-green-800">Restore</button>
                      : <button onClick={() => setArchiveTarget(r)} className="text-xs text-red-500 hover:text-red-700">Archive</button>)}
                  </div>
                </div>
              ))}
        </div>
        {!loading && items.length === 0 && <p className="text-sm text-gray-400 mt-4">No custom {STAGE_LABELS[tab].toLowerCase()} runbooks yet. {isAdmin ? "Duplicate the built-in one or create your own." : ""}</p>}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={close} />
          <div className="relative w-full max-w-2xl card p-0 max-h-[90vh] overflow-hidden animate-scale-in flex flex-col">
            <div className="px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{viewBuiltin ? "Built-in runbook" : editing ? "Edit runbook" : "Create runbook"} · {STAGE_LABELS[tab]}</h2>
              {editing && <p className="text-xs text-gray-500 mt-0.5">Version {editing.version}. Saving creates version {editing.version + 1}; interviews already created keep the version they were created with.</p>}
            </div>
            <div className="px-6 py-5 overflow-y-auto flex-1">
              <fieldset disabled={readOnly} className="space-y-5 min-w-0">
                <Section title="Basics">
                  <div>
                    <label className="label">Name</label>
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input-field" placeholder="e.g. Strict complexity drill" />
                  </div>
                  <div>
                    <label className="label">Description <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="input-field" placeholder="When to use this runbook" />
                  </div>
                </Section>
                <Section title="Instructions" subtitle="The steps the AI follows in this stage, in order. It asks one question per turn and adapts to the answers. It never reveals the reference solutions.">
                  <textarea value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} rows={12} className="input-field font-mono text-xs" placeholder={"1. Ask what each function does...\n2. Ask the time complexity of each function...\n3. ..."} />
                </Section>
                <Section title="Extra probes" subtitle="Questions the AI may use in this stage whatever the problem is.">
                  <StringListEditor label="" items={draft.probes} onChange={(probes) => setDraft({ ...draft, probes })} placeholder="A probe question" />
                </Section>
                <Section title="Extra rubric criteria" subtitle="Added to the problem's own rubric when this stage is scored (for example 'stated the complexity of every function').">
                  <RubricEditor rubric={draft.rubric} onChange={(rubric) => setDraft({ ...draft, rubric })} />
                </Section>
              </fieldset>
              {errors.length > 0 && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 space-y-0.5" role="alert">
                  {errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={close} className="btn-secondary">{readOnly ? "Close" : "Cancel"}</button>
              {viewBuiltin && isAdmin && <button onClick={duplicateBuiltin} className="btn-primary">Duplicate to customize</button>}
              {!readOnly && <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Saving..." : editing ? "Save new version" : "Create runbook"}</button>}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!archiveTarget}
        title="Archive runbook"
        message={`Archive "${archiveTarget?.name}"? It will no longer be offered for new interviews. Existing interviews are unaffected.`}
        confirmLabel="Archive"
        onConfirm={() => archiveTarget && archive(archiveTarget)}
        onCancel={() => setArchiveTarget(null)}
      />
    </DashboardLayout>
  );
}
