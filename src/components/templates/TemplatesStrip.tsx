"use client";

// Compact list of interview templates on the dashboard, with one-click "use" links.
import Link from "next/link";
import { useEffect, useState } from "react";
import { StageChips, type TemplateRow } from "./TemplatesPage";

export function TemplatesStrip() {
  const [items, setItems] = useState<TemplateRow[] | null>(null);

  useEffect(() => {
    fetch("/api/interview-templates")
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]));
  }, []);

  if (items === null) return null;

  return (
    <section className="mb-8 animate-fade-in-up" aria-label="Interview templates">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Interview templates</h2>
        <Link href="/interview-templates" className="text-xs text-indigo-600 hover:text-indigo-800">{items.length ? "Manage templates" : "Create a template"}</Link>
      </div>
      {items.length === 0 ? (
        <div className="card p-4 text-sm text-gray-500">
          Save an interview plan (Part A, DSA, puzzle, with times) once and reuse it for one candidate or a whole CSV upload.{" "}
          <Link href="/interview-templates" className="text-indigo-600 underline">Create your first template</Link>.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, 6).map((t) => (
            <div key={t.id} className="card-hover p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900 truncate">{t.name}</p>
                <span className="text-[11px] text-gray-500 shrink-0">{t.durationMin} min</span>
              </div>
              <div className="mt-2"><StageChips summary={t.summary} /></div>
              <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100 text-xs">
                <Link href={`/new?template=${t.id}`} className="text-indigo-600 hover:text-indigo-800">One candidate</Link>
                <Link href={`/new?mode=bulk&template=${t.id}`} className="text-indigo-600 hover:text-indigo-800">Bulk upload</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
