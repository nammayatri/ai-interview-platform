"use client";

// A drag handle between two panels, like the splitters in LeetCode. "col" sits between a left and a right panel
// (drag sideways), "row" between a top and a bottom panel (drag up and down). Double-click resets the sizes.
import { useRef, useState } from "react";

export function ResizeHandle({ direction, onDrag, onReset, label }: {
  direction: "col" | "row";
  /** Pointer position while dragging (viewport pixels); the caller turns it into a size. */
  onDrag: (clientX: number, clientY: number) => void;
  onReset?: () => void;
  label: string;
}) {
  const [active, setActive] = useState(false);
  const dragging = useRef(false);
  const isCol = direction === "col";

  return (
    <div
      role="separator"
      aria-orientation={isCol ? "vertical" : "horizontal"}
      aria-label={label}
      title={`Drag to resize. Double-click to reset.`}
      onPointerDown={(e) => {
        dragging.current = true;
        setActive(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.style.userSelect = "none";
        document.body.style.cursor = isCol ? "col-resize" : "row-resize";
        e.preventDefault();
      }}
      onPointerMove={(e) => { if (dragging.current) onDrag(e.clientX, e.clientY); }}
      onPointerUp={(e) => {
        dragging.current = false;
        setActive(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      }}
      onDoubleClick={onReset}
      className={`group hidden shrink-0 items-center justify-center lg:flex ${isCol ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize"}`}
      style={{ touchAction: "none" }}
    >
      <div className={`rounded-full transition-colors ${isCol ? "h-12 w-1" : "h-1 w-12"} ${active ? "bg-blue-400" : "bg-white/15 group-hover:bg-blue-400/70"}`} />
    </div>
  );
}
