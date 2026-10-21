"use client";

import { useEffect, useRef, useState } from "react";

const MAX_CHARS = 10_000;
const MIN_INTERVAL_MS = 15_000;

/**
 * Typed notes / pseudocode. Sent to the server at most once every 15 seconds while it changes;
 * the room also includes the latest value with every AI turn, so nothing is lost between saves.
 */
export function Scratchpad({ interviewId, token, value, onChange, placeholder }: { interviewId: string; token: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const lastSentRef = useRef(value);
  const lastSentAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(value);
  latestRef.current = value;
  const [pasteNote, setPasteNote] = useState(false);
  const gutterRef = useRef<HTMLDivElement>(null);
  const blockPaste = () => { setPasteNote(true); window.dispatchEvent(new CustomEvent("scratchpad-paste-blocked")); setTimeout(() => setPasteNote(false), 3000); };
  const blockCopy = () => { setPasteNote(true); window.dispatchEvent(new CustomEvent("scratchpad-copy-blocked")); setTimeout(() => setPasteNote(false), 3000); };
  const lineCount = Math.max(value.split("\n").length, 8);

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
      <div className="relative m-3 mt-2 flex min-h-[96px] flex-1 overflow-hidden rounded-lg border border-white/5 bg-zinc-900/60 focus-within:border-blue-500/40">
        <div ref={gutterRef} aria-hidden className="w-10 shrink-0 select-none overflow-hidden border-r border-white/5 bg-black/20 py-3 pr-2 text-right font-mono text-xs leading-relaxed text-zinc-600">
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
          onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
          onPaste={(e) => { e.preventDefault(); blockPaste(); }}
          onCopy={(e) => { e.preventDefault(); blockCopy(); }}
          onCut={(e) => { e.preventDefault(); blockCopy(); }}
          onDrop={(e) => { e.preventDefault(); blockPaste(); }}
          onBeforeInput={(e) => {
            const t = (e.nativeEvent as InputEvent).inputType;
            if (t === "insertFromPaste" || t === "insertFromDrop" || t === "insertFromYank" || t === "insertFromPasteAsQuotation") { e.preventDefault(); blockPaste(); }
          }}
          onKeyDown={(e) => {
            const k = e.key.toLowerCase();
            if ((e.ctrlKey || e.metaKey) && k === "v") { e.preventDefault(); blockPaste(); return; }
            if (e.shiftKey && e.key === "Insert") { e.preventDefault(); blockPaste(); return; }
            if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "x")) { e.preventDefault(); blockCopy(); return; }
            // Tab indents instead of leaving the box, so code can be typed naturally.
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = el;
              onChange((value.slice(0, a) + "    " + value.slice(b)).slice(0, MAX_CHARS));
              requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 4; });
            }
          }}
          placeholder={placeholder || "Type notes, pseudocode or code here. It is typed only and is not executed."}
          spellCheck={false}
          wrap="off"
          className="min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
      </div>
      {pasteNote && <p className="px-4 pb-2 text-[11px] text-amber-400">Copy and paste are disabled here. Please type your code. Attempts are recorded.</p>}
    </div>
  );
}
