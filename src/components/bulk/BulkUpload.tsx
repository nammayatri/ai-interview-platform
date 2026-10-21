"use client";

// Bulk interview creation: pick a template, upload a CSV or Excel file (email, name, role, parta_code), check the
// preview, create one interview per row.
import { useEffect, useRef, useState } from "react";
import { StageChips, type TemplateRow } from "@/components/templates/TemplatesPage";
import { MAX_BULK_ROWS, SAMPLE_CSV, type BulkRow } from "@/lib/bulk-shared";

interface EmailTemplate { id: string; name: string; description: string; is_default?: boolean }
interface RowResult { rowNumber: number; email: string; status: "created" | "skipped" | "error"; id?: string; url?: string; error?: string }
interface CreateResponse { template: string; created: number; skipped: number; failed: number; results: RowResult[] }

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
};

export function BulkUpload({ templates, emailTemplates, initialTemplateId }: { templates: TemplateRow[]; emailTemplates: EmailTemplate[]; initialTemplateId?: string }) {
  const [templateId, setTemplateId] = useState(initialTemplateId || "");
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<{ rows: BulkRow[]; fatal?: string; needCode: boolean } | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreateResponse | null>(null);
  const [copied, setCopied] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  const template = templates.find((t) => t.id === templateId);
  const needCode = !!template?.stages.some((s) => s.key === "parta");

  useEffect(() => { if (initialTemplateId) setTemplateId(initialTemplateId); }, [initialTemplateId]);
  useEffect(() => {
    const def = emailTemplates.find((e) => e.is_default);
    if (def && !emailTemplateId) setEmailTemplateId(def.id);
  }, [emailTemplates]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setFile(null); setParsed(null); setResult(null); setError(""); };
  const chooseTemplate = (id: string) => { setTemplateId(id); setParsed(null); setResult(null); setError(""); if (file) parse(file, id); };

  const parse = async (f: File, tid = templateId) => {
    setFile(f); setParsed(null); setResult(null); setError("");
    if (!tid) { setError("Choose a template first, then upload the file."); return; }
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("templateId", tid);
      const res = await fetch("/api/bulk-interviews/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not read that file."); return; }
      setParsed(data);
    } catch {
      setError("Could not upload the file. Check your connection and try again.");
    } finally {
      setParsing(false);
    }
  };

  const valid = parsed?.rows.filter((r) => r.errors.length === 0) || [];
  const invalid = parsed?.rows.filter((r) => r.errors.length > 0) || [];

  const create = async () => {
    if (!template || valid.length === 0) return;
    setCreating(true); setError("");
    try {
      const res = await fetch("/api/bulk-interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, emailTemplateId: emailTemplateId || undefined, rows: valid.map((r) => ({ rowNumber: r.rowNumber, email: r.email, name: r.name, role: r.role, code: r.code })) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not create the interviews."); return; }
      setResult(data);
    } catch {
      setError("The request failed. Nothing may have been created: check the dashboard before trying again.");
    } finally {
      setCreating(false);
    }
  };

  const link = (url?: string) => (url ? `${window.location.origin}${url}` : "");
  const copy = (text: string, key: string) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1500); };
  const nameOf = (email: string) => parsed?.rows.find((r) => r.email === email)?.name || "";

  const columns = needCode ? "email, name, parta_code (role is optional)" : "email, name (role is optional)";
  const sample = needCode ? SAMPLE_CSV : "email,name\nasha@example.com,Asha Rao\nravi@example.com,Ravi Kumar\n";

  // ── Results ──
  if (result) {
    const made = result.results.filter((r) => r.status === "created");
    return (
      <div className="card p-6 space-y-5 animate-scale-in">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-green-50 flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">{result.created} interview{result.created === 1 ? "" : "s"} created</h2>
          <p className="text-sm text-gray-500 mt-1">Template: {result.template}{emailTemplateId ? ". Invitation emails are being sent." : ". No email template chosen: the default invite is sent where email is configured."}</p>
          {(result.skipped > 0 || result.failed > 0) && <p className="text-sm text-amber-700 mt-1">{result.skipped} skipped (row problems), {result.failed} failed.</p>}
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          <button className="btn-primary" disabled={made.length === 0} onClick={() => copy(made.map((r) => `${r.email}: ${link(r.url)}`).join("\n"), "all")}>{copied === "all" ? "Copied!" : "Copy all links"}</button>
          <button className="btn-secondary" onClick={() => download("interview-links.csv", "row,email,name,status,link,note\n" + result.results.map((r) => [r.rowNumber, r.email, nameOf(r.email), r.status, link(r.url), r.error || ""].map((v) => csvCell(String(v))).join(",")).join("\n") + "\n")}>Download results (CSV)</button>
          <button className="btn-secondary" onClick={reset}>Upload another file</button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-3 py-2 text-left">Row</th><th className="px-3 py-2 text-left">Email</th><th className="px-3 py-2 text-left">Result</th><th className="px-3 py-2 text-left">Link</th></tr></thead>
            <tbody>
              {result.results.map((r) => (
                <tr key={r.rowNumber} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-500">{r.rowNumber}</td>
                  <td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2">{r.status === "created" ? <span className="badge-success">created</span> : <span className="badge-danger" title={r.error}>{r.status}</span>}{r.error && <span className="ml-2 text-xs text-red-600">{r.error}</span>}</td>
                  <td className="px-3 py-2">{r.url && <button className="text-xs text-indigo-600 hover:text-indigo-800" onClick={() => copy(link(r.url), String(r.rowNumber))}>{copied === String(r.rowNumber) ? "Copied!" : "Copy link"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Template */}
      <div className="card p-6 border-l-4 border-l-indigo-500">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">1. Choose a template</h3>
        <p className="text-xs text-gray-500 mb-3">Every candidate in the file gets this interview plan.</p>
        {templates.length === 0 ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No templates yet. <a href="/interview-templates" className="underline font-medium">Create one</a> first.</p>
        ) : (
          <>
            <select value={templateId} onChange={(e) => chooseTemplate(e.target.value)} className="input-field" aria-label="Template">
              <option value="">Select a template...</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.durationMin} min)</option>)}
            </select>
            {template && (
              <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
                <StageChips summary={template.summary} />
                <p className="text-xs text-gray-500">{template.level} level · {template.durationMin} minutes in total.</p>
                {template.summary.some((s) => s.itemProblem || s.runbookProblem) && <p className="text-xs text-red-600">Something in this template was archived or deleted. <a href="/interview-templates" className="underline">Edit the template</a> before using it.</p>}
              </div>
            )}
          </>
        )}
      </div>

      {/* 2. File */}
      <div className="card p-6 border-l-4 border-l-emerald-500">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold text-gray-900">2. Upload the candidates</h3>
          <button type="button" className="text-xs text-indigo-600 hover:text-indigo-800" onClick={() => download("candidates-sample.csv", sample)}>Download a sample CSV</button>
        </div>
        <p className="text-xs text-gray-500 mb-3">A .csv or .xlsx file with a header row and these columns: <code className="bg-gray-100 px-1 rounded">{columns}</code>. Up to {MAX_BULK_ROWS} candidates.{needCode ? " Put each candidate's code in the parta_code cell (multi-line code is fine)." : ""}</p>
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) parse(f); }}
          onClick={() => picker.current?.click()}
          className={`rounded-xl border-2 border-dashed text-center cursor-pointer transition p-8 ${over ? "border-indigo-400 bg-indigo-50" : file ? "border-green-300 bg-green-50" : "border-gray-300 hover:border-indigo-300 hover:bg-indigo-50/30"}`}
        >
          <input ref={picker} type="file" accept=".csv,.xlsx,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) parse(f); e.target.value = ""; }} />
          {parsing ? <p className="text-sm text-gray-600">Reading {file?.name}...</p>
            : file ? <p className="text-sm text-green-700 font-medium">{file.name} <span className="text-gray-500 font-normal">· drop another file to replace it</span></p>
            : <p className="text-sm text-gray-600">Drop a CSV or Excel file here, or <span className="text-indigo-600 font-medium">browse</span></p>}
        </div>
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        {parsed?.fatal && <p className="mt-3 text-sm text-red-600" role="alert">{parsed.fatal}</p>}
      </div>

      {/* 3. Preview */}
      {parsed && !parsed.fatal && (
        <div className="card p-6 border-l-4 border-l-amber-500 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">3. Check and create</h3>
            <p className="text-xs text-gray-600"><span className="text-green-700 font-medium">{valid.length} ready</span>{invalid.length > 0 && <>, <span className="text-red-600 font-medium">{invalid.length} with problems (will be skipped)</span></>}</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0"><tr><th className="px-3 py-2 text-left">Row</th><th className="px-3 py-2 text-left">Email</th><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Role</th>{parsed.needCode && <th className="px-3 py-2 text-left">Code</th>}<th className="px-3 py-2 text-left">Check</th></tr></thead>
              <tbody>
                {parsed.rows.map((r) => (
                  <tr key={r.rowNumber} className={`border-t border-gray-100 ${r.errors.length ? "bg-red-50/50" : ""}`}>
                    <td className="px-3 py-2 text-gray-500">{r.rowNumber}</td>
                    <td className="px-3 py-2">{r.email}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">{r.role}</td>
                    {parsed.needCode && <td className="px-3 py-2 text-xs text-gray-500 font-mono max-w-[200px] truncate" title={r.code.slice(0, 400)}>{r.code ? `${r.code.split("\n").length} lines · ${r.code.split("\n")[0].slice(0, 40)}` : "—"}</td>}
                    <td className="px-3 py-2 text-xs">{r.errors.length ? <span className="text-red-600">{r.errors.join("; ")}</span> : <span className="text-green-700">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {emailTemplates.length > 0 && (
            <div>
              <label className="label">Invitation email <span className="text-gray-400 font-normal">(sent to each candidate with their link)</span></label>
              <select value={emailTemplateId} onChange={(e) => setEmailTemplateId(e.target.value)} className="input-field">
                <option value="">Don&apos;t use an email template</option>
                {emailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}
              </select>
            </div>
          )}
          <button className="btn-primary w-full !py-3 text-base" disabled={creating || valid.length === 0 || !!template?.summary.some((s) => s.itemProblem || s.runbookProblem)} onClick={create}>
            {creating ? `Creating ${valid.length} interviews...` : `Create ${valid.length} interview${valid.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
