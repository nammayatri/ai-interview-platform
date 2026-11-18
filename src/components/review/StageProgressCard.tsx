"use client";

// "Current stage" card on the interview View page (/dashboard/[id]): which part (Part A, DSA, Puzzle) and puzzle stage
// the candidate is in, when each started, and whether they are offline. Refreshes every 5 seconds until the interview
// is completed; pauses while the browser tab is hidden. Hidden for interviews without parts.
import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewProgress, PartStatus } from "@/lib/interview-progress";
import { StageBoxes } from "@/components/dsa/StageBoxes";

const POLL_MS = 5000;

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

function offlineFor(seconds: number): string {
  if (seconds >= 3600) return "over an hour";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

function PartIcon({ status }: { status: PartStatus }) {
  if (status === "done") {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
        <circle cx="10" cy="10" r="10" fill="#047857" />
        <path d="M6 10.5l2.5 2.5L14 7.5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "current") {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
        <circle cx="10" cy="10" r="9" fill="#fff" stroke="#4338ca" strokeWidth="2" />
        <circle cx="10" cy="10" r="4" fill="#4338ca" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <circle cx="10" cy="10" r="9" fill={status === "skipped" ? "#f3f4f6" : "#fff"} stroke="#9ca3af" strokeWidth="2" strokeDasharray={status === "skipped" ? "3 3" : undefined} />
    </svg>
  );
}

const STATUS_TEXT: Record<PartStatus, string> = { done: "completed", current: "in progress", pending: "not reached", skipped: "skipped" };

export function StageProgressCard({ interviewId }: { interviewId: string }) {
  const [data, setData] = useState<InterviewProgress | null>(null);
  const stoppedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/interview/${interviewId}/progress`, { cache: "no-store" });
      if (!res.ok) return; // keep showing the last good state
      const next: InterviewProgress = await res.json();
      setData(next);
      // Nothing more will change once the interview is over, or when there is no card to show.
      if (!next.show || next.state === "completed") stoppedRef.current = true;
    } catch {
      // network hiccup: try again on the next tick
    }
  }, [interviewId]);

  useEffect(() => {
    stoppedRef.current = false;
    load();
    const id = setInterval(() => {
      if (stoppedRef.current || document.hidden) return;
      load();
    }, POLL_MS);
    const onVisible = () => { if (!document.hidden && !stoppedRef.current) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  if (!data || !data.show) return null;

  const running = data.state === "running";
  const stages = data.puzzleStages;

  return (
    <section className="card p-6 animate-fade-in-right" aria-labelledby="stage-progress-title">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 id="stage-progress-title" className="text-lg font-semibold text-gray-900">Current stage</h2>
        {running && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-2 w-2 rounded-full bg-green-600" aria-hidden="true" />
            Live
          </span>
        )}
      </div>

      <p aria-live="polite" className="mb-4">
        {running && (
          <span className="inline-block rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[13px] font-semibold text-indigo-900">Now: {data.now}</span>
        )}
        {data.state === "not_started" && (
          <span className="inline-block rounded-lg bg-gray-100 px-2.5 py-1.5 text-[13px] font-semibold text-gray-700">Not started</span>
        )}
        {data.state === "completed" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[13px] font-semibold text-emerald-800">
            <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2 2 5-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Completed
          </span>
        )}
      </p>

      {data.offlineSeconds !== null && (
        <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-[13px] font-semibold text-orange-800">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
            <path d="M8 1.5l6.5 12h-13z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M8 6v3.5M8 11.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Offline · no signal for {offlineFor(data.offlineSeconds)}
        </div>
      )}

      <ol className="space-y-3">
        {data.parts.map((part) => (
          <li key={part.key}>
            <div className="flex items-center gap-2.5" aria-label={`${part.label}: ${STATUS_TEXT[part.status]}`}>
              <PartIcon status={part.status} />
              <span className={`flex-1 text-sm font-semibold ${part.status === "current" ? "text-indigo-900" : part.status === "done" ? "text-gray-900" : "text-gray-600"}`}>
                {part.label}
              </span>
              {part.status === "skipped" ? (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">Skipped</span>
              ) : (
                part.startedAt && <span className="text-xs text-gray-600">started {time(part.startedAt)}</span>
              )}
            </div>

            {part.key === "puzzle" && stages && (
              <div className="ml-[30px] mt-2.5 space-y-2">
                <StageBoxes stages={stages} tone="light" size="md" />
                {stages.startedAt.some(Boolean) && (
                  <ul className="space-y-0.5 text-xs text-gray-600">
                    {stages.labels.map((label, i) =>
                      stages.startedAt[i] ? <li key={`${i}-${label}`}>Stage {label} · {time(stages.startedAt[i])}</li> : null
                    )}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
