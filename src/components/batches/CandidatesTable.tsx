"use client";

// The candidates of one batch, laid out exactly like the dashboard's interview table: same columns, status badges,
// score ring, verdict badge, proctoring cell, date and View button, with the same search and filter pills.
import Link from "next/link";
import { useMemo, useState } from "react";
import { passVerdict, toHundred } from "@/lib/score-scale";
import type { LiveStatus } from "@/lib/batch-live";

export interface BatchCandidate {
  id: string; name: string; email: string; phone: string; resumeFileName: string;
  role: string; level: string; status: string; registeredAt: string;
  startedAt: string | null; endedAt: string | null; scoringStatus: string | null;
  recommendation: string | null; overall: number | null; flags: number; warnings: number;
  /** Only for candidates who are in the test right now. */
  live?: LiveStatus | null;
}

type SortField = "date" | "score" | "status";

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
const PHASE_LABEL: Record<string, string> = { parta: "Part A", dsa: "DSA", puzzle: "Puzzle" };
const aiVerdict = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());

/** Where a running candidate is: finished phases ticked, the current one with its puzzle stage, and any sign of trouble. */
function NowCell({ live }: { live: LiveStatus }) {
  const offline = live.secondsSinceHeartbeat !== null && live.secondsSinceHeartbeat > 60;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {live.phases.length === 0 && <span className="text-xs text-gray-400">Just started</span>}
        {live.phases.map((p) => (
          <span key={p.key} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${p.status === "completed" ? "bg-green-50 text-green-700" : p.status === "active" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-400"}`}>
            {p.status === "completed" ? "✓ " : ""}{PHASE_LABEL[p.key] || p.key}{p.status === "active" && p.key === "puzzle" ? ` · Stage ${live.stage || "1"}` : ""}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-gray-500">
        {live.hintsUsed > 0 ? `${live.hintsUsed} hint${live.hintsUsed === 1 ? "" : "s"} · ` : ""}
        {live.strikes > 0 ? `${live.strikes} strike${live.strikes === 1 ? "" : "s"} · ` : ""}
        {offline ? <span className="font-medium text-red-600">no signal for {Math.round((live.secondsSinceHeartbeat as number) / 60)} min</span> : "connected"}
      </p>
    </div>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case "waiting":
      return (<span className="badge-warning"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5" />Waiting</span>);
    case "in_progress":
      return (
        <span className="badge-info">
          <span className="relative flex h-2 w-2 mr-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
          In Progress
        </span>
      );
    case "completed":
      return (<span className="badge-success"><span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5" />Completed</span>);
    default:
      return <span className="badge-info">{status}</span>;
  }
}

export function CandidatesTable({ candidates, batchName, passMark }: { candidates: BatchCandidate[]; batchName: string; passMark: number }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (f: SortField) => {
    if (sortField === f) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortField(f); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    let r = candidates;
    if (statusFilter !== "all") r = r.filter((c) => c.status === statusFilter);
    if (verdictFilter !== "all") {
      if (verdictFilter === "pass") r = r.filter((c) => passVerdict(c.overall, passMark) === "pass");
      else if (verdictFilter === "fail") r = r.filter((c) => passVerdict(c.overall, passMark) === "fail");
      else if (verdictFilter === "unscored") r = r.filter((c) => c.overall === null);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((c) => `${c.name} ${c.email} ${c.phone} ${c.role}`.toLowerCase().includes(q));
    }
    const order: Record<string, number> = { in_progress: 0, waiting: 1, completed: 2 };
    return [...r].sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") cmp = new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime();
      else if (sortField === "score") cmp = (a.overall ?? -1) - (b.overall ?? -1);
      else cmp = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [candidates, statusFilter, verdictFilter, search, sortField, sortDir, passMark]);

  const exportCSV = () => {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Name", "Email", "Phone", "Role", "Level", "Status", "Score (out of 100)", "Result", "AI recommendation", "Flags", "Warnings", "Registered"];
    const rows = filtered.map((c) => [c.name, c.email, c.phone, c.role, c.level, c.status, toHundred(c.overall) ?? "", passVerdict(c.overall, passMark) ?? "", c.recommendation ? c.recommendation.replace(/_/g, " ") : "", c.flags, c.warnings, c.registeredAt]);
    const url = URL.createObjectURL(new Blob([[head, ...rows].map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${batchName.replace(/[^\w-]+/g, "_")}_candidates.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <svg className={`w-3.5 h-3.5 ml-1 inline-block transition-all duration-200 ${sortField === field ? "text-indigo-600" : "text-gray-400"} ${sortField === field && sortDir === "asc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
  const th = "text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3";
  const thSort = `${th} cursor-pointer select-none hover:text-gray-700 transition-colors`;
  const pills = (items: { key: string; label: string }[], value: string, set: (k: string) => void) => (
    <div className="flex items-center gap-1 rounded-lg p-1 border border-gray-200 bg-gray-50/50">
      {items.map((f) => (
        <button key={f.key} onClick={() => set(f.key)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${value === f.key ? "bg-indigo-600 text-white shadow-sm" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"}`}>{f.label}</button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search by name, email, phone or role..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 pl-11 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-700 transition-all duration-200 placeholder:text-gray-400" />
          </div>
          <button onClick={exportCSV} disabled={filtered.length === 0}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {pills([{ key: "all", label: "All" }, { key: "waiting", label: "Pending" }, { key: "in_progress", label: "Active" }, { key: "completed", label: "Completed" }], statusFilter, setStatusFilter)}
          {pills([{ key: "all", label: "All Results" }, { key: "pass", label: `Pass (${passMark}+)` }, { key: "fail", label: "Fail" }, { key: "unscored", label: "Unscored" }], verdictFilter, setVerdictFilter)}
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-500">Nobody has registered yet.</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-500">No candidate matches these filters.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className={th}>Candidate</th>
                  <th className={th}>Role</th>
                  <th className={thSort} onClick={() => toggleSort("status")}>Status <SortIcon field="status" /></th>
                  <th className={thSort} onClick={() => toggleSort("score")}>Score <SortIcon field="score" /></th>
                  <th className={th}>Result</th>
                  <th className={th}>Right now</th>
                  <th className={th}>Proctoring</th>
                  <th className={thSort} onClick={() => toggleSort("date")}>Registered <SortIcon field="date" /></th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => {
                  const total = c.flags + c.warnings;
                  return (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/80 transition-all duration-200 animate-table-row" style={{ animationDelay: `${Math.min(idx, 20) * 50}ms`, opacity: 0 }}>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900">{c.name || c.email || c.resumeFileName}</p>
                        {c.name && <p className="text-xs text-gray-500 mt-0.5">{c.email}</p>}
                        {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-900">{c.role}</p>
                        <p className="text-xs text-gray-500">{c.level}</p>
                      </td>
                      <td className="px-6 py-4">{statusBadge(c.status)}</td>
                      <td className="px-6 py-4">
                        {c.overall !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="relative w-8 h-8">
                              <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="14" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                                <circle cx="18" cy="18" r="14" fill="none" stroke={passVerdict(c.overall, passMark) === "pass" ? "#22c55e" : "#ef4444"} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${((toHundred(c.overall) ?? 0) / 100) * 87.96} 87.96`} />
                              </svg>
                              <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${passVerdict(c.overall, passMark) === "pass" ? "text-green-600" : "text-red-600"}`}>{toHundred(c.overall)}</span>
                            </div>
                          </div>
                        ) : c.scoringStatus === "generating" ? (
                          <span className="text-xs text-gray-500">Scoring…</span>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {c.overall !== null ? (
                          <div>
                            <span className={passVerdict(c.overall, passMark) === "pass" ? "badge-success" : "badge-danger"}>{passVerdict(c.overall, passMark) === "pass" ? "Pass" : "Fail"}</span>
                            {c.recommendation && <p className="mt-0.5 text-[11px] text-gray-400" title="The AI's own recommendation">AI: {aiVerdict(c.recommendation)}</p>}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">{c.status === "in_progress" && c.live ? <NowCell live={c.live} /> : <span className="text-sm text-gray-400">-</span>}</td>
                      <td className="px-6 py-4">
                        {total > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                            <span className="text-xs text-gray-600">
                              {c.flags > 0 && <span className="text-red-600">{c.flags} flag{c.flags !== 1 ? "s" : ""}</span>}
                              {c.flags > 0 && c.warnings > 0 && ", "}
                              {c.warnings > 0 && <span className="text-amber-600">{c.warnings} warn</span>}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-green-600">Clean</span>
                        )}
                      </td>
                      <td className="px-6 py-4"><span className="text-sm text-gray-500">{formatDate(c.registeredAt)}</span></td>
                      <td className="px-6 py-4">
                        <Link href={`/dashboard/${c.id}`} className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-all duration-200">View</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="text-center py-3">
        <p className="text-xs text-gray-500">Showing {filtered.length} of {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}</p>
      </div>
    </div>
  );
}
