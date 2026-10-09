"use client";

import { Markdown } from "./Markdown";

export function PuzzlePanel({ title, statementMd }: { title: string; statementMd: string }) {
  return (
    <div className="glass flex min-h-0 flex-1 flex-col rounded-2xl">
      <div className="px-4 pt-3">
        <h3 className="truncate text-sm font-semibold text-zinc-100">{title}</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2">
        <Markdown dark>{statementMd}</Markdown>
      </div>
    </div>
  );
}
