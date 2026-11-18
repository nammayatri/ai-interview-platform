"use client";

import type { StageProgress } from "@/lib/puzzle-stages";

/**
 * One box per puzzle stage: green with a tick when completed, white when not, and a thick amber border on the current
 * stage. "dark" sits in the candidate's top bar; "light" on the staff View page.
 */
export function StageBoxes({ stages, tone = "dark", size = "lg" }: { stages: StageProgress; tone?: "dark" | "light"; size?: "md" | "lg" }) {
  const done = Math.min(stages.completed, stages.labels.length);
  const green = tone === "dark" ? "border border-emerald-500 bg-emerald-500 text-white" : "border border-emerald-700 bg-emerald-700 text-white";
  const box = size === "lg" ? "h-9 min-w-9 rounded-lg px-2.5 text-sm" : "h-8 min-w-8 rounded-lg px-2.5 text-[13px]";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2" role="list" aria-label={`Puzzle stages: ${done} of ${stages.labels.length} completed`}>
      {stages.labels.map((label, i) => {
        const completed = i < done;
        const current = !completed && stages.current === i;
        const state = completed ? "completed" : current ? "current stage" : "not started";
        return (
          <span
            key={`${i}-${label}`}
            role="listitem"
            title={`Stage ${label}: ${state}`}
            aria-label={`Stage ${label}: ${state}`}
            className={[
              "inline-flex items-center justify-center gap-1 font-semibold transition-colors duration-300",
              box,
              completed
                ? green
                : current
                  ? `border-2 ${tone === "dark" ? "border-amber-400" : "border-amber-600"} bg-white text-zinc-900`
                  : tone === "dark" ? "border border-zinc-300 bg-white text-zinc-500" : "border border-gray-300 bg-white text-gray-600",
            ].join(" ")}
          >
            {completed && <span aria-hidden="true">✓</span>}
            {label}
          </span>
        );
      })}
    </div>
  );
}
