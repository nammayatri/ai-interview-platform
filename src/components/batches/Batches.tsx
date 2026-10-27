"use client";

// Interview batches: one shared join link for many candidates. The list/create page and the detail page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ConfirmModal } from "@/components/ConfirmModal";
import { DEFAULT_LATE_ENTRY_MIN, DEFAULT_OPENS_BEFORE_MIN } from "@/lib/batches-defaults";
import { StageChips, type TemplateRow } from "@/components/templates/TemplatesPage";
import { CandidatesTable, type BatchCandidate } from "./CandidatesTable";
import { BatchSettingsPanel, BatchSettingsFields } from "./BatchSettingsPanel";
import { defaultBatchSettings, type BatchSettings } from "@/lib/batch-settings";
import { InviteFilePicker, InviteModal, submitInvites, summarise, type ParsedInvites } from "./InviteCandidates";

type Phase = "not_open" | "open" | "live" | "closed";
interface BatchRow {
  id: string; name: string; joinPath: string; templateId: string | null; templateName: string; stages: any[]; level: string; role: string;
  startsAt: string; opensAt: string; closesAt: string; opensBeforeMin: number; lateEntryMin: number; maxCandidates: number | null;
  isClosed: boolean; phase: Phase; registered: number; started: number; completed: number; createdAt: string;
  isArchived: boolean; durationMin: number; createdByName: string | null;
  invited: number; emailsSent: number; emailsFailed: number; invitedLoggedIn: number;
  settings: BatchSettings;
}
interface InviteView {
  id: string; email: string; name: string; emailStatus: string; emailSentAt: string | null; emailError: string | null; emailAttempts: number;
  invitedAt: string; interviewId: string | null; registeredAt: string | null; startedAt: string | null; endedAt: string | null;
  status: "invited" | "email_sent" | "email_failed" | "logged_in" | "started" | "completed";
}

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const PHASE: Record<Phase, { label: string; cls: string }> = {
  not_open: { label: "Not open yet", cls: "badge-info" },
  open: { label: "Registration open", cls: "badge-warning" },
  live: { label: "Live", cls: "badge-success" },
  closed: { label: "Closed", cls: "badge-danger" },
};
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

type Bucket = "ongoing" | "completed" | "archived";
const bucketOf = (b: BatchRow): Bucket => (b.isArchived ? "archived" : b.phase === "closed" ? "completed" : "ongoing");
const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} hr${Math.floor(min / 60) > 1 ? "s" : ""}${min % 60 ? ` ${min % 60} mins` : ""}` : `${min} mins`);
const longWhen = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const Icon = ({ d }: { d: string }) => (
  <svg className="h-4 w-4 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>
);
const MAIL = "M3 8l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z";
const CLOCK = "M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z";
const CAL = "M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z";

export function BatchesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  const canEdit = role === "admin" || role === "interviewer";
  const [items, setItems] = useState<BatchRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [inviteFor, setInviteFor] = useState<BatchRow | null>(null);
  const [copied, setCopied] = useState("");

  // Filters, like the test list in an assessment tool
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<Bucket>("ongoing");
  const [creator, setCreator] = useState("all");
  const [created, setCreated] = useState("any");

  // New batch form
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [opensBefore, setOpensBefore] = useState(String(DEFAULT_OPENS_BEFORE_MIN));
  const [lateEntry, setLateEntry] = useState(String(DEFAULT_LATE_ENTRY_MIN));
  const [roleName, setRoleName] = useState("Software Engineer");
  const [maxCandidates, setMaxCandidates] = useState("");
  const [rules, setRules] = useState<BatchSettings>(() => defaultBatchSettings({}));
  const [rulesTouched, setRulesTouched] = useState(false);
  const rulesTouchedRef = useRef(false);
  const [parsed, setParsed] = useState<ParsedInvites | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [b, t] = await Promise.all([
      fetch("/api/batches").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/interview-templates").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    setItems(b); setTemplates(t); setLoading(false);
  }, []);
  // The form starts from the server's defaults (the env values), so an untouched form behaves exactly as before.
  useEffect(() => {
    fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((c) => {
      if (!c) return;
      setRules((cur) => rulesTouchedRef.current ? cur : defaultBatchSettings({
        PROCTORING_ENFORCE: String(c.proctoringEnforced), MAX_PROCTORING_STRIKES: String(c.maxProctoringStrikes), ALLOW_MEDIA_TOGGLE: String(c.allowMediaToggle),
      }));
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  const template = templates.find((t) => t.id === templateId);
  const validInvites = parsed?.rows.filter((r) => r.errors.length === 0).length ?? 0;

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
          ...(rulesTouched ? { settings: rules } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "Could not create the batch.");
      // The batch exists now. A failed invite step must not hide that, so it is reported on the batch page instead.
      let note = "";
      if (parsed && validInvites > 0) {
        try {
          const r = await submitInvites(data.id, parsed, sendEmail);
          note = r.ok ? summarise(r.data) : r.data?.error || "The candidates could not be added.";
        } catch { note = "The candidates could not be added. Open the batch and upload the file again."; }
        try { sessionStorage.setItem("batch-note", note); } catch { /* ignore */ }
      }
      window.location.href = `/batches/${data.id}`;
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const archive = async (b: BatchRow) => {
    await fetch(`/api/batches/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isArchived: !b.isArchived }) }).catch(() => {});
    load();
  };
  const copy = (b: BatchRow) => {
    const full = `${window.location.origin}${b.joinPath}`;
    navigator.clipboard.writeText(full).then(() => { setCopied(b.id); setTimeout(() => setCopied(""), 1500); }).catch(() => {});
  };

  const counts = { ongoing: 0, completed: 0, archived: 0 } as Record<Bucket, number>;
  items.forEach((b) => { counts[bucketOf(b)]++; });
  const creators = Array.from(new Set(items.map((b) => b.createdByName).filter(Boolean))) as string[];
  const cutoff = created === "any" ? 0 : Date.now() - Number(created) * 86400000;
  const q = query.trim().toLowerCase();
  const shown = items.filter((b) =>
    bucketOf(b) === bucket &&
    (creator === "all" || b.createdByName === creator) &&
    (!cutoff || new Date(b.createdAt).getTime() >= cutoff) &&
    (!q || b.name.toLowerCase().includes(q) || b.templateName.toLowerCase().includes(q)));

  const radio = (key: Bucket, label: string) => (
    <label key={key} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
      <input type="radio" name="batch-bucket" className="h-4 w-4 accent-indigo-600" checked={bucket === key} onChange={() => setBucket(key)} />
      <span className={bucket === key ? "font-medium text-indigo-600" : "text-gray-700"}>{label} ({counts[key]})</span>
    </label>
  );

  return (
    <DashboardLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row">
        {/* Filters */}
        <aside className="w-full shrink-0 space-y-5 md:w-56">
          <div>
            <p className="mb-1 text-sm font-semibold text-gray-900">Batch status</p>
            {radio("ongoing", "Ongoing")}{radio("completed", "Completed")}{radio("archived", "Archived")}
          </div>
          <div className="border-t border-gray-200 pt-4">
            <label className="mb-1 block text-sm font-semibold text-gray-900">Created by</label>
            <select className="input-field" value={creator} onChange={(e) => setCreator(e.target.value)}>
              <option value="all">All</option>
              {creators.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-900">Creation date</label>
            <select className="input-field" value={created} onChange={(e) => setCreated(e.target.value)}>
              <option value="any">Any time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1">
              <input className="input-field rounded-r-none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by batch or template name" aria-label="Search batches" />
              <span className="flex items-center rounded-r-lg bg-indigo-600 px-3 text-white" aria-hidden><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.3-4.3M17 10a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></span>
            </div>
            {canEdit && <button className="btn-primary shrink-0" onClick={() => { setShowForm(true); setError(""); }}>+ Create new batch</button>}
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
          ) : shown.length === 0 ? (
            <div className="card p-10 text-center text-sm text-gray-500">{items.length === 0 ? "No batches yet. Create one to get a link and invite candidates." : "No batches match these filters."}</div>
          ) : (
            <div className="space-y-4">
              {shown.map((b) => {
                const open = () => router.push(`/batches/${b.id}`);
                return (
                  <div key={b.id} className="card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button type="button" onClick={open} className="text-left text-lg font-semibold text-gray-900 hover:text-indigo-600">{b.name}</button>
                      <PhaseBadge phase={b.phase} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                      <span className="flex items-center gap-1.5"><Icon d={MAIL} />{b.invited > 0 ? plural(b.invited, "candidate") + " invited" : "Link only"}</span>
                      <span className="hidden h-4 w-px bg-gray-300 sm:block" />
                      <span className="flex items-center gap-1.5"><Icon d={CLOCK} />{hours(b.durationMin)}</span>
                      <span className="hidden h-4 w-px bg-gray-300 sm:block" />
                      <span className="flex items-center gap-1.5"><Icon d={CAL} />Starts {longWhen(b.startsAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">Login opens {b.opensBeforeMin} min before the start · late entry up to {b.lateEntryMin} min after · {b.templateName}</p>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                      <p className="text-sm text-gray-700">
                        {b.invited > 0
                          ? <>{plural(b.invited, "candidate has", "candidates have")} been invited, {b.emailsSent} emailed{b.emailsFailed > 0 && <span className="text-red-600"> ({b.emailsFailed} failed)</span>}, {b.invitedLoggedIn} logged in and {b.completed} {b.completed === 1 ? "has" : "have"} taken the test.</>
                          : <>No candidates invited yet. {plural(b.registered, "person")} registered through the link.</>}{" "}
                        <button type="button" onClick={open} className="font-medium text-indigo-600 hover:underline">View candidate report</button>
                      </p>
                      <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-indigo-600">
                        {canEdit && <button type="button" className="hover:underline" onClick={() => setInviteFor(b)}>Invite candidates</button>}
                        <button type="button" className="hover:underline" onClick={() => copy(b)}>{copied === b.id ? "Link copied" : "Copy link"}</button>
                        {canEdit && <button type="button" className="hover:underline" onClick={() => archive(b)}>{b.isArchived ? "Unarchive" : "Archive"}</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {inviteFor && <InviteModal batch={inviteFor} onClose={() => setInviteFor(null)} onDone={load} />}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Create a batch" onClick={(e) => { if (e.target === e.currentTarget && !saving) setShowForm(false); }}>
          <form onSubmit={create} className="card my-6 w-full max-w-2xl space-y-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900">Create new batch</h2>
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
            <details className="rounded-lg border border-gray-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-900">
                Test rules and proctoring <span className="font-normal text-gray-500">· pass mark {rules.passMark}/100, {rules.proctoring.enforce ? `ends at ${rules.proctoring.maxStrikes} strikes` : "no removal for strikes"}</span>
              </summary>
              <div className="mt-4">
                <BatchSettingsFields value={rules} canEdit onChange={(fn) => { rulesTouchedRef.current = true; setRulesTouched(true); setRules(fn); }} />
                <p className="mt-3 text-xs text-gray-500">You can change these later on the batch page, even while candidates are taking the test.</p>
              </div>
            </details>
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <div>
                <p className="text-sm font-medium text-gray-900">Invite candidates <span className="font-normal text-gray-400">(optional, you can do this later)</span></p>
                <p className="text-xs text-gray-500">Upload a CSV or Excel file of candidate emails. Each person is emailed the link, the login time and the start time.</p>
              </div>
              <InviteFilePicker onParsed={setParsed} />
              {validInvites > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                  Email the {plural(validInvites, "candidate")} as soon as the batch is created
                </label>
              )}
            </div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" disabled={saving} onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" disabled={saving || !templateId || !name.trim()}>{saving ? "Creating…" : "Create batch"}</button>
            </div>
          </form>
        </div>
      )}
    </DashboardLayout>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export function BatchDetailPage({ id }: { id: string }) {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  const canEdit = role === "admin" || role === "interviewer";
  const [batch, setBatch] = useState<(BatchRow & { candidates: BatchCandidate[]; invites: InviteView[] }) | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState("");
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

  const load = useCallback(async () => {
    const res = await fetch(`/api/batches/${id}`).catch(() => null);
    if (!res) return;
    if (res.status === 404) { setMissing(true); return; }
    if (res.ok) setBatch(await res.json());
  }, [id]);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);
  // The create form leaves a one-line summary of the invitations it just sent.
  useEffect(() => {
    try { const n = sessionStorage.getItem("batch-note"); if (n) { setNote(n); sessionStorage.removeItem("batch-note"); } } catch { /* ignore */ }
  }, []);

  const sendEmails = async (inviteIds?: string[]) => {
    setSending(inviteIds?.length === 1 ? inviteIds[0] : "all"); setError(""); setNote("");
    try {
      const res = await fetch(`/api/batches/${id}/invites/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inviteIds ? { inviteIds } : {}) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Could not send the emails.");
      else setNote(`${d.sent} email${d.sent === 1 ? "" : "s"} sent${d.failed ? `, ${d.failed} failed${d.firstError ? ` (${d.firstError})` : ""}` : ""}.`);
      await load();
    } finally {
      setSending("");
    }
  };
  const rescoreMissing = async () => {
    setError(""); setNote("");
    const res = await fetch(`/api/batches/${id}/rescore`, { method: "POST" }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    if (!res?.ok) setError(d?.error || "Could not start scoring.");
    else setNote(d.started > 0 ? `Scoring ${d.started} interview${d.started === 1 ? "" : "s"} again. Scores appear here as they finish.` : "Nothing to score: every finished interview already has a score or is being scored.");
    await load();
  };
  const removeInvite = async (inviteId: string) => {
    await fetch(`/api/batches/${id}/invites/${inviteId}`, { method: "DELETE" }).catch(() => {});
    load();
  };

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

  const unscored = batch ? batch.candidates.filter((c) => c.status === "completed" && c.overall === null && c.scoringStatus !== "generating").length : 0;

  if (missing) return <DashboardLayout><div className="card mx-auto max-w-xl p-10 text-center text-sm text-gray-600">This batch was not found. <Link href="/batches" className="text-indigo-600">Back to batches</Link></div></DashboardLayout>;
  if (!batch) return <DashboardLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div></DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
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

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
          <span><span className="text-lg font-semibold text-gray-900">{batch.registered}</span> registered{batch.maxCandidates ? ` of ${batch.maxCandidates}` : ""}</span>
          <span><span className="text-lg font-semibold text-gray-900">{batch.started}</span> started</span>
          <span><span className="text-lg font-semibold text-blue-600">{batch.candidates.filter((c) => c.status === "in_progress").length}</span> in the test now</span>
          <span><span className="text-lg font-semibold text-gray-900">{batch.completed}</span> completed</span>
          {unscored > 0 && canEdit && <span className="flex items-center gap-2"><span className="text-amber-600">{unscored} without a score</span><button className="text-xs font-medium text-indigo-600 hover:underline" onClick={rescoreMissing}>Score them again</button></span>}
        </div>

        <BatchSettingsPanel
          settings={batch.settings}
          canEdit={canEdit}
          running={batch.candidates.filter((c) => c.status === "in_progress").length}
          onSave={(next) => patch({ settings: next })}
        />

        {(batch.invites.length > 0 || canEdit) && (
          <div className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Invited candidates</h2>
                <p className="text-xs text-gray-500">
                  {batch.invites.length} invited · {batch.emailsSent} emailed{batch.emailsFailed > 0 && <span className="text-red-600"> · {batch.emailsFailed} failed</span>} · {batch.invitedLoggedIn} logged in · {batch.invites.filter((v) => v.status === "completed").length} completed
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {batch.invites.some((v) => v.emailStatus !== "sent") && <button className="btn-secondary" disabled={!!sending} onClick={() => sendEmails()}>{sending === "all" ? "Sending…" : `Send to ${batch.invites.filter((v) => v.emailStatus !== "sent").length} not emailed`}</button>}
                  <button className="btn-primary" onClick={() => setShowInvite(true)}>Invite candidates</button>
                </div>
              )}
            </div>
            {note && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{note}</p>}
            {batch.invites.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">Nobody invited yet. Upload a CSV or Excel file of candidate emails and each person gets the link and the times.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500"><th className="py-2 pr-3 font-medium">Candidate</th><th className="py-2 pr-3 font-medium">Email</th><th className="py-2 pr-3 font-medium">Logged in</th><th className="py-2 pr-3 font-medium">Test</th>{canEdit && <th className="py-2 text-right font-medium">Actions</th>}</tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {batch.invites.map((v) => (
                      <tr key={v.id}>
                        <td className="py-2.5 pr-3"><p className="font-medium text-gray-900">{v.name || "—"}</p><p className="text-xs text-gray-500">{v.email}</p></td>
                        <td className="py-2.5 pr-3">
                          {v.emailStatus === "sent" ? <><span className="badge-success">Sent</span><p className="mt-0.5 text-xs text-gray-500">{v.emailSentAt ? when(v.emailSentAt) : ""}</p></>
                            : v.emailStatus === "failed" ? <><span className="badge-danger" title={v.emailError || ""}>Failed</span><p className="mt-0.5 max-w-[16rem] truncate text-xs text-red-600" title={v.emailError || ""}>{v.emailError}</p></>
                            : <span className="badge-warning">Not sent</span>}
                        </td>
                        <td className="py-2.5 pr-3">{v.interviewId ? <><span className="badge-success">Logged in</span><p className="mt-0.5 text-xs text-gray-500">{v.registeredAt ? when(v.registeredAt) : ""}</p></> : <span className="text-xs text-gray-400">Not yet</span>}</td>
                        <td className="py-2.5 pr-3">
                          {v.status === "completed" ? <span className="badge-success">Completed</span> : v.status === "started" ? <span className="badge-info">In progress</span> : v.interviewId ? <span className="badge-warning">Waiting</span> : <span className="text-xs text-gray-400">Not started</span>}
                        </td>
                        {canEdit && (
                          <td className="py-2.5 text-right text-xs font-medium">
                            {!v.interviewId && <button className="mr-3 text-indigo-600 hover:underline disabled:opacity-50" disabled={!!sending} onClick={() => sendEmails([v.id])}>{sending === v.id ? "Sending…" : v.emailStatus === "sent" ? "Resend" : "Send email"}</button>}
                            {!v.interviewId && <button className="text-red-600 hover:underline" onClick={() => removeInvite(v.id)}>Remove</button>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div>
          <h2 className="mb-2 text-base font-semibold text-gray-900">All candidates who registered</h2>
          <CandidatesTable candidates={batch.candidates} batchName={batch.name} passMark={batch.settings.passMark} />
        </div>
      </div>
      {showInvite && <InviteModal batch={batch} onClose={() => setShowInvite(false)} onDone={load} />}
      <ConfirmModal open={confirmDelete} title="Delete this batch?" message="The link stops working. A batch with registered candidates cannot be deleted, close it instead." confirmLabel="Delete" onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </DashboardLayout>
  );
}
