"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders problem/puzzle statements. GFM gives tables and task lists. Raw HTML is not rendered. */
export function Markdown({ children, dark = false, className = "" }: { children: string; dark?: boolean; className?: string }) {
  return (
    <div className={`md-prose ${dark ? "md-dark" : ""} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ""}</ReactMarkdown>
    </div>
  );
}
