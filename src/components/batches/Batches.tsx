"use client";

// Interview batches: one shared join link for many candidates. The list/create page and the detail page.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConfirmModal } from "@/components/ConfirmModal";
import { DEFAULT_LATE_ENTRY_MIN, DEFAULT_OPENS_BEFORE_MIN } from "@/lib/batches-defaults";
import { StageChips, type TemplateRow } from "@/components/templates/TemplatesPage";

type Phase = "not_open" | "open" | "live" | "closed";
interface BatchRow {
  id: string; name: string; joinPath: string; templateId: string | null; templateName: string; stages: any[]; level: string; role: string;
  startsAt: string; opensAt: string; closesAt: string; opensBeforeMin: number; lateEntryMin: number; maxCandidates: number | null;
  isClosed: boolean; phase: Phase; registered: number; started: number; completed: number; createdAt: string;
}
interface Candidate {
  id: string; name: string; email: string; phone: string; resumeFileName: string; status: string; registeredAt: string;
  startedAt: string | null; endedAt: string | null; scoringStatus: string | null; recommendation: string | null; overall: number | null;
}

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const PHASE: Record<Phase, { label: string; cls: string }> = {
  not_open: { label: "Not open yet", cls: "badge-info" },
  open: { label: "Registration open", cls: "badge-warning" },
  live: { label: "Live", cls: "badge-success" },
  closed: { label: "Closed", cls: "badge-danger" },
};
const REC: Record<string, string> = { strong_hire: "Strong hire", hire: "Hire", no_hire: "No hire", strong_no_hire: "Strong no hire" };
// An <input type="datetime-local"> value, in the browser's own time zone.
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function PhaseBadge({ phase }: { phase: Phase }) {
  return <span className={PHASE[phase].cls}>{PHASE[phase].label}</span>;
}

function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const full = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={full} onFocus={(e) => e.currentTarget.select()} className="input-field font-mono text-xs" />
      <button type="button" className="btn-secondary shrink-0" onClick={() => { navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy link"}</button>
    </div>
  );
}

// ─── List + create ───────────────────────────────────────────────────────────

export function BatchesPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  const canEdit = role === "admin" || role === "interviewer";
  const [items, setItems] = useState<BatchRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [opensBefore, setOpensBefore] = useState(String(DEFAULT_OPENS_BEFORE_MIN));
  const [lateEntry, setLateEntry] = useState(String(DEFAULT_LATE_ENTRY_MIN));
  const [roleName, setRoleName] = useState("Software Engineer");
  const [maxCandidates, setMaxCandidates] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [b, t] = await Promise.all([
      fetch("/api/batches").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/interview-templates").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    setItems(b); setTemplates(t); setLoading(false);
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  const template = templates.find((t) => t.id === templateId);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!startsAt) return setError("Choose the start date and time.");
    setSaving(true);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, templateId, role: roleName, startsAt: new Date(startsAt).toISOString(),
          opensBeforeMin: Number(opensBefore), lateEntryMin: Number(lateEntry), maxCandidates: maxCandidates === "" ? null : Number(maxCandidates),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "Could not create the batch.");
      window.location.href = `/batches/${data.id}`;
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Interview batches</h1>
            <p className="mt-1 text-sm text-gray-500">One link for many candidates. They register on the link, wait for the start time, then take the interview.</p>
          </div>
          {canEdit && <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New batch"}</button>}
        </div>

        {showForm && (
          <form onSubmit={create} className="card space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Batch name</label>
                <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Campus drive, 2 Nov 11:00" maxLength={255} required />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Interview template</label>
                <select className="input-field" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                  <option value="">Choose a template</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.durationMin} min)</option>)}
                </select>
                {template && <div className="mt-2"><StageChips summary={template.summary} /></div>}
                {template?.stages.some((s) => s.key === "parta") && <p className="mt-2 text-xs text-gray-500">This template has a Part A stage, so candidates will be asked to paste their Part A solution when they register.</p>}
              </div>
              <div>
                <label className="label">Start date and time</label>
                <input type="datetime-local" className="input-field" value={startsAt} min={toLocalInput(new Date())} onChange={(e) => setStartsAt(e.target.value)} required />
                <p className="mt-1 text-xs text-gray-500">In your time zone.</p>
              </div>
              <div>
                <label className="label">Role shown to the AI</label>
                <input className="input-field" value={roleName} onChange={(e) => setRoleName(e.target.value)} maxLength={255} />
              </div>
              <div>
                <label className="label">Login opens (minutes before start)</label>
                <input type="number" min={0} max={1440} className="input-field" value={opensBefore} onChange={(e) => setOpensBefore(e.target.value)} />
                <p className="mt-1 text-xs text-gray-500">Candidates can log in and register this long before the start (default {DEFAULT_OPENS_BEFORE_MIN}).</p>
              </div>
              <div>
                <label className="label">Late entry allowed (minutes after start)</label>
                <input type="number" min={0} max={240} className="input-field" value={lateEntry} onChange={(e) => setLateEntry(e.target.value)} />
              </div>
              <div>
                <label className="label">Candidate limit <span className="font-normal text-gray-400">(optional)</span></label>
                <input type="number" min={1} className="input-field" value={maxCandidates} onChange={(e) => setMaxCandidates(e.target.value)} placeholder="No limit" />
              </div>
            </div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-end"><button className="btn-primary" disabled={saving || !templateId || !name.trim()}>{saving ? "Creating…" : "Create batch and get link"}</button></div>
          </form>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
        ) : items.length === 0 ? (
          <div className="card p-10 text-center text-sm text-gray-500">No batches yet. Create one to get a link you can share with candidates.</div>
        ) : (
          <div className="space-y-3">
            {items.map((b) => (
              <div key={b.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/batches/${b.id}`} className="text-base font-semibold text-gray-900 hover:text-indigo-700">{b.name}</Link>
                    <p className="mt-0.5 text-sm text-gray-500">{b.templateName} · starts {when(b.startsAt)}</p>
                  </div>
                  <PhaseBadge phase={b.phase} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
                  <span><span className="font-semibold text-gray-900">{b.registered}</span> registered</span>
                  <span><span className="font-semibold text-gray-900">{b.started}</span> started</span>
                  <span><span className="font-semibold text-gray-900">{b.completed}</span> completed</span>
                </div>
                <div className="mt-3"><CopyLink path={b.joinPath} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export function BatchDetailPage({ id }: { id: string }) {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  const canEdit = role === "admin" || role === "interviewer";
  const [batch, setBatch] = useState<(BatchRow & { candidates: Candidate[] }) | null>(null);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [opensBefore, setOpensBefore] = useState("");
  const [lateEntry, setLateEntry] = useState("");
  const [maxCandidates, setMaxCandidates] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/batches/${id}`).catch(() => null);
    if (!res) return;
    if (res.status === 404) { setMissing(true); return; }
    if (res.ok) setBatch(await res.json());
  }, [id]);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);

  const openEdit = () => {
    if (!batch) return;
    setName(batch.name); setStartsAt(toLocalInput(new Date(batch.startsAt)));
    setOpensBefore(String(batch.opensBeforeMin)); setLateEntry(String(batch.lateEntryMin)); setMaxCandidates(batch.maxCandidates ? String(batch.maxCandidates) : "");
    setError(""); setEdit(true);
  };
  const patch = async (body: Record<string, unknown>) => {
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/batches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Could not save."); return false; }
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startsAt) return setError("Choose the start date and time.");
    const ok = await patch({ name, startsAt: new Date(startsAt).toISOString(), opensBeforeMin: Number(opensBefore), lateEntryMin: Number(lateEntry), maxCandidates: maxCandidates === "" ? null : Number(maxCandidates) });
    if (ok) setEdit(false);
  };
  const remove = async () => {
    const res = await fetch(`/api/batches/${id}`, { method: "DELETE" });
    if (res.ok) window.location.href = "/batches";
    else { const d = await res.json().catch(() => ({})); setError(d.error || "Could not delete."); setConfirmDelete(false); }
  };
  const exportCsv = () => {
    if (!batch) return;
    const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [["name", "email", "phone", "status", "recommendation", "overall", "registered_at"].join(",")].concat(
      batch.candidates.map((c) => [c.name, c.email, c.phone, c.status, c.recommendation ? REC[c.recommendation] || c.recommendation : "", c.overall ?? "", c.registeredAt].map((v) => cell(String(v))).join(","))
    );
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${batch.name.replace(/[^\w-]+/g, "_")}-candidates.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (missing) return <DashboardLayout><div className="card mx-auto max-w-xl p-10 text-center text-sm text-gray-600">This batch was not found. <Link href="/batches" className="text-indigo-600">Back to batches</Link></div></DashboardLayout>;
  if (!batch) return <DashboardLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div></DashboardLayout>;

  const shown = batch.candidates.filter((c) => !filter.trim() || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const statusBadge = (c: Candidate) =>
    c.status === "completed" ? <span className="badge-success">Completed</span>
    : c.status === "in_progress" ? <span className="badge-info animate-pulse">In progress</span>
    : <span className="badge-warning">Waiting</span>;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="text-sm"><Link href="/batches" className="text-gray-500 hover:text-gray-700">Batches</Link> <span className="text-gray-400">/</span> <span className="font-medium text-gray-900">{batch.name}</span></div>

        <div className="card space-y-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{batch.name}</h1>
              <p className="mt-1 text-sm text-gray-500">{batch.templateName} · {batch.role} · {batch.level}</p>
            </div>
            <PhaseBadge phase={batch.phase} />
          </div>
          <div className="grid gap-3 text-sm text-gray-700 sm:grid-cols-3">
            <div><p className="text-xs uppercase tracking-wider text-gray-500">Login opens</p>{when(batch.opensAt)}</div>
            <div><p className="text-xs uppercase tracking-wider text-gray-500">Test starts</p>{when(batch.startsAt)}</div>
            <div><p className="text-xs uppercase tracking-wider text-gray-500">Entry closes</p>{when(batch.closesAt)}</div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-gray-700">Link for candidates</p>
            <CopyLink path={batch.joinPath} />
            <p className="mt-1.5 text-xs text-gray-500">Send this one link to everyone. It shows a countdown until registration opens.</p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <button className="btn-secondary" onClick={openEdit}>Edit times</button>
              <button className="btn-secondary" disabled={saving} onClick={() => patch({ isClosed: !batch.isClosed })}>{batch.isClosed ? "Reopen" : "Close batch"}</button>
              <button className="btn-secondary text-red-600" onClick={() => setConfirmDelete(true)}>Delete</button>
              {batch.isClosed && <span className="self-center text-xs text-gray-500">Closed: nobody can register or start, until you reopen it.</span>}
            </div>
          )}
          {error && !edit && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>

        {edit && (
          <form onSubmit={saveEdit} className="card space-y-4 p-6">
            <h2 className="text-base font-semibold text-gray-900">Edit batch</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label">Batch name</label><input className="input-field" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} /></div>
              <div><label className="label">Start date and time</label><input type="datetime-local" className="input-field" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
              <div><label className="label">Candidate limit</label><input type="number" min={1} className="input-field" value={maxCandidates} onChange={(e) => setMaxCandidates(e.target.value)} placeholder="No limit" /></div>
              <div><label className="label">Login opens (min before start)</label><input type="number" min={0} className="input-field" value={opensBefore} onChange={(e) => setOpensBefore(e.target.value)} /></div>
              <div><label className="label">Late entry (min after start)</label><input type="number" min={0} className="input-field" value={lateEntry} onChange={(e) => setLateEntry(e.target.value)} /></div>
            </div>
            <p className="text-xs text-gray-500">Candidates already registered follow the new start time automatically.</p>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEdit(false)}>Cancel</button><button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button></div>
          </form>
        )}

        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
              <span><span className="text-lg font-semibold text-gray-900">{batch.registered}</span> registered{batch.maxCandidates ? ` of ${batch.maxCandidates}` : ""}</span>
              <span><span className="text-lg font-semibold text-gray-900">{batch.started}</span> started</span>
              <span><span className="text-lg font-semibold text-gray-900">{batch.completed}</span> completed</span>
            </div>
            <div className="flex items-center gap-2">
              <input className="input-field !w-56" placeholder="Search name, email, phone" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button className="btn-secondary" onClick={exportCsv} disabled={batch.candidates.length === 0}>Export CSV</button>
            </div>
          </div>
          {batch.candidates.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">Nobody has registered yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-gray-500">
                  <tr><th className="py-2 pr-4">Candidate</th><th className="py-2 pr-4">Phone</th><th className="py-2 pr-4">Registered</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Result</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 pr-4"><Link href={c.status === "completed" ? `/review/${c.id}` : `/dashboard/${c.id}`} className="font-medium text-gray-900 hover:text-indigo-700">{c.name || "(no name)"}</Link><div className="text-xs text-gray-500">{c.email}</div></td>
                      <td className="py-2.5 pr-4 text-gray-600">{c.phone}</td>
                      <td className="py-2.5 pr-4 text-gray-600">{new Date(c.registeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="py-2.5 pr-4">{statusBadge(c)}</td>
                      <td className="py-2.5 pr-4 text-gray-700">{c.recommendation ? `${REC[c.recommendation] || c.recommendation}${c.overall !== null ? ` · ${c.overall}` : ""}` : c.scoringStatus === "generating" ? "Scoring…" : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No candidate matches that search.</p>}
            </div>
          )}
        </div>
      </div>
      <ConfirmModal open={confirmDelete} title="Delete this batch?" message="The link stops working. A batch with registered candidates cannot be deleted, close it instead." confirmLabel="Delete" onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </DashboardLayout>
  );
}
