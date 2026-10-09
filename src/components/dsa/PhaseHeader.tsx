"use client";

const fmt = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;

export function PhaseHeader({ phaseKey, title, phaseRemainingSec, totalRemainingSec }: {
  phaseKey: "dsa" | "puzzle" | null; title: string; phaseRemainingSec: number | null; totalRemainingSec: number;
}) {
  const label = phaseKey === "dsa" ? "Part 1 · Your solution" : phaseKey === "puzzle" ? "Part 2 · Puzzle" : "Wrapping up";
  return (
    <div className="glass flex items-center justify-between gap-3 rounded-xl px-4 py-2" aria-live="off">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">{label}</p>
        {title && <p className="truncate text-sm font-medium text-zinc-100">{title}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-4 font-mono text-xs">
        {phaseRemainingSec !== null && (
          <span className={phaseRemainingSec <= 60 ? "text-amber-300" : "text-zinc-300"} title="Time left in this part">
            <span className="mr-1 font-sans text-[10px] uppercase text-zinc-500">Part</span>{fmt(phaseRemainingSec)}
          </span>
        )}
        <span className={totalRemainingSec <= 60 ? "text-red-400 font-semibold" : "text-zinc-400"} title="Total time left">
          <span className="mr-1 font-sans text-[10px] uppercase text-zinc-500">Total</span>{fmt(totalRemainingSec)}
        </span>
      </div>
    </div>
  );
}
