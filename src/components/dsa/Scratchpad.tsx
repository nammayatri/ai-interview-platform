"use client";

import { useEffect, useRef } from "react";

const MAX_CHARS = 10_000;
const MIN_INTERVAL_MS = 15_000;

/**
 * Typed notes / pseudocode. Sent to the server at most once every 15 seconds while it changes;
 * the room also includes the latest value with every AI turn, so nothing is lost between saves.
 */
export function Scratchpad({ interviewId, token, value, onChange }: { interviewId: string; token: string; value: string; onChange: (v: string) => void }) {
  const lastSentRef = useRef(value);
  const lastSentAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(value);
  latestRef.current = value;

  useEffect(() => {
    if (value === lastSentRef.current) return;
    if (timerRef.current) return; // a send is already scheduled; it will pick up the latest value
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastSentAtRef.current));
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      const content = latestRef.current;
      if (content === lastSentRef.current) return;
      lastSentAtRef.current = Date.now();
      try {
        const res = await fetch(`/api/interview/${interviewId}/scratchpad`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, content }),
        });
        if (res.ok) lastSentRef.current = content;
      } catch {
        /* the next AI turn carries the latest scratchpad anyway */
      }
    }, wait);
  }, [value, interviewId, token]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="glass flex min-h-0 flex-1 flex-col rounded-2xl">
      <div className="flex items-center justify-between px-4 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Scratchpad</h3>
        <span className="text-[10px] text-zinc-500">{value.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
        placeholder="Type notes or pseudocode here. The interviewer can see them. You can't run code in this round."
        spellCheck={false}
        className="m-3 mt-2 min-h-[96px] flex-1 resize-none rounded-lg border border-white/5 bg-zinc-900/60 p-3 font-mono text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500/40 focus:outline-none"
      />
    </div>
  );
}
