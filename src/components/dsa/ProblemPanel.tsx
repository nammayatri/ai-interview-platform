"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Markdown } from "./Markdown";
import type { CandidateSubmission } from "./useDsaRoom";

const CodeEditor = dynamic(() => import("../CodeEditor"), { ssr: false });

const OUTCOME_STYLE: Record<string, string> = {
  passed: "bg-green-500/15 text-green-300",
  partial: "bg-amber-500/15 text-amber-300",
  failed: "bg-red-500/15 text-red-300",
};

function PlainCode({ code }: { code: string }) {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  return (
    <pre className="h-full min-h-[160px] overflow-auto rounded-lg border border-white/10 bg-[#1e1e1e] p-3 font-mono text-[12px] leading-5 text-zinc-200">
      {lines.map((l, i) => (
        <div key={i} className="flex">
          <span className="mr-3 w-8 shrink-0 select-none text-right text-zinc-600">{i + 1}</span>
          <span className="whitespace-pre-wrap break-all">{l || " "}</span>
        </div>
      ))}
    </pre>
  );
}

/** The problem statement and the candidate's own submitted code, read-only with line numbers. */
export function ProblemPanel({ title, statementMd, submission }: { title: string; statementMd: string; submission?: CandidateSubmission }) {
  const [monacoReady, setMonacoReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Monaco loads from a CDN; if it does not come up, show the code as plain text instead.
  useEffect(() => {
    if (!submission || monacoReady) return;
    const t = setTimeout(() => setFallback(true), 6000);
    return () => clearTimeout(t);
  }, [submission, monacoReady]);

  return (
    <div className="glass flex min-h-0 flex-1 flex-col rounded-2xl">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h3 className="truncate text-sm font-semibold text-zinc-100">{title}</h3>
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="shrink-0 text-xs text-zinc-400 hover:text-white lg:hidden">
          {collapsed ? "Show problem" : "Hide problem"}
        </button>
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 pt-2">
          <div className="max-h-[40%] shrink-0 overflow-y-auto pr-1 lg:max-h-[45%]">
            <Markdown dark>{statementMd}</Markdown>
          </div>
          {submission && (
            <div className="flex min-h-[180px] flex-1 flex-col">
              <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-zinc-500">Your submission</span>
                {submission.language && <span>{submission.language}</span>}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${OUTCOME_STYLE[submission.outcome] || ""}`}>{submission.outcome}</span>
              </div>
              <div className="min-h-0 flex-1">
                {fallback && !monacoReady ? (
                  <PlainCode code={submission.code} />
                ) : (
                  <CodeEditor readOnly language={submission.language} initialCode={submission.code} onReady={() => setMonacoReady(true)} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
