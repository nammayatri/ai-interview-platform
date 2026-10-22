"use client";

// Inviting candidates to a batch: pick a CSV or Excel file (email column, name optional), see what was read, and
// optionally email everyone the link and the times. The same picker is used when creating a batch.
import { useRef, useState } from "react";

export interface InviteRowView { rowNumber: number; email: string; name: string; errors: string[] }
export interface ParsedInvites { rows: InviteRowView[]; fileName: string }

const SAMPLE = "email,name\nasha@example.com,Asha Rao\nravi@example.com,Ravi Kumar\n";
const fmt = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function InviteFilePicker({ onParsed }: { onParsed: (p: ParsedInvites | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<ParsedInvites | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(""); setParsed(null); onParsed(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/batches/parse-invites", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "Could not read that file.");
      if (data.fatal) return setError(data.fatal);
      const p = { rows: data.rows as InviteRowView[], fileName: file.name };
      setParsed(p); onParsed(p);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const valid = parsed?.rows.filter((r) => r.errors.length === 0).length ?? 0;
  const bad = parsed?.rows.filter((r) => r.errors.length > 0) ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept=".csv,.xlsx,.txt,.tsv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading…" : parsed ? "Choose a different file" : "Choose CSV or Excel file"}</button>
        <a className="text-sm text-indigo-600 hover:underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="batch-candidates.csv">Download sample</a>
        <span className="text-xs text-gray-500">Needs an <code>email</code> column. <code>name</code> is optional.</span>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {parsed && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="text-gray-700"><span className="font-semibold text-gray-900">{valid}</span> candidate{valid === 1 ? "" : "s"} ready from <span className="font-mono text-xs">{parsed.fileName}</span>{bad.length > 0 && <>, <span className="font-semibold text-red-600">{bad.length}</span> row{bad.length === 1 ? "" : "s"} will be skipped</>}.</p>
          {bad.length > 0 && (
            <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-xs text-red-600">
              {bad.slice(0, 50).map((r) => <li key={r.rowNumber}>Row {r.rowNumber}{r.email ? ` (${r.email})` : ""}: {r.errors.join(", ")}</li>)}
            </ul>
          )}
          {valid > 0 && (
            <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-xs text-gray-600">
              {parsed.rows.filter((r) => r.errors.length === 0).slice(0, 8).map((r) => <li key={r.rowNumber}>{r.name ? `${r.name} · ` : ""}{r.email}</li>)}
              {valid > 8 && <li className="text-gray-400">and {valid - 8} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Saves the parsed rows on a batch and optionally emails them. Returns the server's summary. */
export async function submitInvites(batchId: string, parsed: ParsedInvites, sendEmail: boolean) {
  const res = await fetch(`/api/batches/${batchId}/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: parsed.rows.filter((r) => r.errors.length === 0), sendEmail }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function summarise(d: any): string {
  const parts = [`${d.added} added`];
  if (d.alreadyInvited) parts.push(`${d.alreadyInvited} already invited`);
  if (d.invalid) parts.push(`${d.invalid} skipped`);
  if (d.emailsSent) parts.push(`${d.emailsSent} email${d.emailsSent === 1 ? "" : "s"} sent`);
  if (d.emailsFailed) parts.push(`${d.emailsFailed} email${d.emailsFailed === 1 ? "" : "s"} failed${d.firstEmailError ? ` (${d.firstEmailError})` : ""}`);
  return parts.join(", ") + ".";
}

export function InviteModal({ batch, onClose, onDone }: { batch: { id: string; name: string; opensAt: string; startsAt: string; closesAt: string }; onClose: () => void; onDone: () => void }) {
  const [parsed, setParsed] = useState<ParsedInvites | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const valid = parsed?.rows.filter((r) => r.errors.length === 0).length ?? 0;

  const go = async () => {
    if (!parsed) return;
    setBusy(true); setError("");
    try {
      const { ok, data } = await submitInvites(batch.id, parsed, sendEmail);
      if (!ok) return setError(data.error || "Could not add the candidates.");
      setResult(summarise(data));
      onDone();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Invite candidates" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="card max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto p-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Invite candidates</h2>
          <p className="mt-0.5 text-sm text-gray-500">{batch.name}</p>
        </div>
        <div className="grid gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 sm:grid-cols-3">
          <div><p className="uppercase tracking-wider text-gray-400">Login opens</p><p className="font-medium text-gray-800">{fmt(batch.opensAt)}</p></div>
          <div><p className="uppercase tracking-wider text-gray-400">Test starts</p><p className="font-medium text-gray-800">{fmt(batch.startsAt)}</p></div>
          <div><p className="uppercase tracking-wider text-gray-400">Entry closes</p><p className="font-medium text-gray-800">{fmt(batch.closesAt)}</p></div>
        </div>
        {result ? (
          <>
            <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{result}</p>
            <div className="flex justify-end"><button className="btn-primary" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <InviteFilePicker onParsed={setParsed} />
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              <span>Email each candidate the link and these times now<span className="block text-xs text-gray-500">You can also send later from the batch page. Each person&apos;s email status is tracked there.</span></span>
            </label>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={go} disabled={busy || valid === 0}>{busy ? (sendEmail ? "Adding and emailing…" : "Adding…") : `Add ${valid || ""} candidate${valid === 1 ? "" : "s"}${sendEmail && valid ? " and send emails" : ""}`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
