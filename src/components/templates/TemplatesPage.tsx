"use client";

// Interview templates: a saved stage plan (which stages, in what order, how long, which question or random, which
// runbook) used for single and bulk interview creation.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  StageBuilder,
  applyTemplateStages,
  emptyStagesForm,
  formToTemplateStages,
  stagesFormError,
  computeDuration,
  type ItemOption,
  type RunbookOption,
  type StagesForm,
} from "@/components/dsa/StageBuilder";
import { LEVELS, STAGE_LABELS, type StagePlan, type StageKey } from "@/lib/runbook";

export interface TemplateSummaryRow {
  key: StageKey; budgetMin: number; graceMin: number; mode: string; itemTitle: string; itemProblem: boolean; runbookName: string; runbookProblem: boolean;
}
export interface TemplateRow {
  id: string; name: string; description: string; level: string; stages: StagePlan[]; summary: TemplateSummaryRow[]; durationMin: number; version: number; isArchived: boolean;
}

const STAGE_COLOR: Record<StageKey, string> = { parta: "bg-indigo-50 text-indigo-700 border-indigo-200", dsa: "bg-emerald-50 text-emerald-700 border-emerald-200", puzzle: "bg-amber-50 text-amber-700 border-amber-200" };

export function StageChips({ summary }: { summary: TemplateSummaryRow[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {summary.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-300 text-xs">→</span>}
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STAGE_COLOR[s.key]}`} title={`${s.itemTitle} · ${s.runbookName}`}>
            {STAGE_LABELS[s.key]} {s.budgetMin}m{s.graceMin ? ` +${s.graceMin}` : ""}
          </span>
        </span>
      ))}
    </div>
  );
}

export function TemplatesPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  const canEdit = role === "admin" || role === "interviewer";

  const [items, setItems] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [partaQuestions, setPartaQuestions] = useState<ItemOption[]>([]);
  const [dsaProblems, setDsaProblems] = useState<ItemOption[]>([]);
  const [puzzles, setPuzzles] = useState<ItemOption[]>([]);
  const [runbooks, setRunbooks] = useState<RunbookOption[]>([]);

  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("Mid");
  const [form, setForm] = useState<StagesForm>(emptyStagesForm());
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<TemplateRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/interview-templates?archived=${showArchived}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const get = (url: string, set: (d: any[]) => void) => fetch(url).then((r) => r.json()).then((d) => Array.isArray(d) && set(d)).catch(() => {});
    get("/api/problems?kind=parta", setPartaQuestions);
    get("/api/problems?kind=dsa", setDsaProblems);
    get("/api/puzzles", setPuzzles);
    get("/api/runbooks", setRunbooks);
  }, []);

  const openCreate = () => { setEditing(null); setName(""); setDescription(""); setLevel("Mid"); setForm(emptyStagesForm()); setErrors([]); setOpen(true); };
  const openEdit = (t: TemplateRow) => { setEditing(t); setName(t.name); setDescription(t.description); setLevel(t.level); setForm(applyTemplateStages(emptyStagesForm(), t.stages)); setErrors([]); setOpen(true); };
  const close = () => { setOpen(false); setEditing(null); };

  const save = async () => {
    const problems: string[] = [];
    if (!name.trim()) problems.push("Give the template a name");
    const e = stagesFormError(form, { requireCode: false });
    if (e) problems.push(e);
    if (problems.length) { setErrors(problems); return; }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/interview-templates/${editing.id}` : "/api/interview-templates", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), level, stages: formToTemplateStages(form) }),
      });
      const data = await res.json();
      if (!res.ok) { setErrors(data.errors || [data.error || "Could not save"]); return; }
      close();
      load();
    } catch {
      setErrors(["Network error while saving"]);
    } finally {
      setSaving(false);
    }
  };

  const archive = async (t: TemplateRow) => {
    await fetch(`/api/interview-templates/${t.id}`, { method: "DELETE" });
    setArchiveTarget(null);
    load();
  };
  const restore = async (t: TemplateRow) => {
    await fetch(`/api/interview-templates/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: t.name, description: t.description, level: t.level, stages: t.stages, isArchived: false }) });
    load();
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8 animate-fade-in-down">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Interview Templates</h1>
            <p className="text-sm text-gray-500 mt-1">Save an interview plan once (the stages, their times and grace, the question or random picks, and the runbooks) and reuse it for one candidate or a whole bulk upload.</p>
            {!canEdit && <p className="text-xs text-amber-600 mt-1">Read-only: ask an admin or interviewer to create templates.</p>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-1.5 text-xs text-gray-500"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
            {canEdit && <button onClick={openCreate} className="btn-primary">Create template</button>}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2">{[1, 2].map((i) => <div key={i} className="card p-5"><div className="skeleton h-5 w-48 mb-3" /><div className="skeleton h-4 w-64" /></div>)}</div>
        ) : items.length === 0 ? (
          <div className="card p-16 text-center">
            <p className="text-xl font-semibold text-gray-900 mb-2">No templates yet</p>
            <p className="text-gray-500 max-w-md mx-auto">A template is a ready-made interview plan, for example &quot;Part A, DSA and puzzle&quot; or &quot;Part A and DSA only&quot;.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((t) => {
              const warn = t.summary.some((s) => s.itemProblem || s.runbookProblem);
              return (
                <div key={t.id} className={`card-hover p-5 ${t.isArchived ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-gray-900">{t.name}</h3>
                    <span className="text-xs text-gray-500 shrink-0">{t.durationMin} min · {t.level}</span>
                  </div>
                  {t.description && <p className="text-xs text-gray-500 mt-1">{t.description}</p>}
                  <div className="mt-3"><StageChips summary={t.summary} /></div>
                  <ul className="mt-3 space-y-0.5">
                    {t.summary.map((s) => (
                      <li key={s.key} className="text-[11px] text-gray-500 truncate">
                        <span className="font-medium text-gray-700">{STAGE_LABELS[s.key]}:</span> {s.itemTitle}
                        {(s.itemProblem) && <span className="text-red-500"> (archived or deleted)</span>} · {s.runbookName}{s.runbookProblem && <span className="text-red-500"> (archived or deleted)</span>}
                      </li>
                    ))}
                  </ul>
                  {warn && <p className="mt-2 text-xs text-red-600">Something this template uses was archived or deleted. Edit the template before using it.</p>}
                  <div className="flex flex-wrap gap-3 pt-3 mt-3 border-t border-gray-100 text-xs">
                    {!t.isArchived && <Link href={`/new?template=${t.id}`} className="text-indigo-600 hover:text-indigo-800">Use for one candidate</Link>}
                    {!t.isArchived && <Link href={`/new?mode=bulk&template=${t.id}`} className="text-indigo-600 hover:text-indigo-800">Use for bulk upload</Link>}
                    {canEdit && <button onClick={() => openEdit(t)} className="text-gray-600 hover:text-gray-900">Edit</button>}
                    {canEdit && (t.isArchived
                      ? <button onClick={() => restore(t)} className="text-green-600 hover:text-green-800">Restore</button>
                      : <button onClick={() => setArchiveTarget(t)} className="text-red-500 hover:text-red-700">Archive</button>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={close} />
          <div className="relative w-full max-w-3xl card p-0 max-h-[92vh] overflow-hidden animate-scale-in flex flex-col">
            <div className="px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{editing ? "Edit template" : "Create template"}</h2>
              {editing && <p className="text-xs text-gray-500 mt-0.5">Version {editing.version}. Interviews already created are not affected by changes.</p>}
            </div>
            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="label">Name <span className="text-red-400">*</span></label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="e.g. Part A complete evaluation" />
                </div>
                <div>
                  <label className="label">Level</label>
                  <select value={level} onChange={(e) => setLevel(e.target.value)} className="input-field">{LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select>
                </div>
              </div>
              <div>
                <label className="label">Description <span className="text-gray-400 font-normal">(optional)</span></label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} className="input-field" placeholder="When to use it" />
              </div>
              <StageBuilder templateMode form={form} onChange={setForm} partaQuestions={partaQuestions} dsaProblems={dsaProblems} puzzles={puzzles} runbooks={runbooks} startStep={1} />
              {errors.length > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 space-y-0.5" role="alert">{errors.map((e, i) => <p key={i}>{e}</p>)}</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500">Total interview time: <strong>{computeDuration(form)} min</strong></span>
              <div className="flex gap-2">
                <button onClick={close} className="btn-secondary">Cancel</button>
                <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Saving..." : editing ? "Save changes" : "Create template"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal open={!!archiveTarget} title="Archive template" message={`Archive "${archiveTarget?.name}"? It will no longer be offered for new interviews. Interviews already created are unaffected.`} confirmLabel="Archive" onConfirm={() => archiveTarget && archive(archiveTarget)} onCancel={() => setArchiveTarget(null)} />
    </DashboardLayout>
  );
}
