"use client";

// The rules of one batch: the passing mark and the proctoring checks. Saved changes reach candidates who are taking the
// test right now (their browser picks them up within about 15 seconds).
import { useEffect, useMemo, useState } from "react";
import { PROCTORING_CHECKS, type BatchSettings } from "@/lib/batch-settings";

function Toggle({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2.5 ${disabled ? "opacity-60" : "cursor-pointer hover:bg-gray-50"}`}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {help && <span className="block text-xs text-gray-500">{help}</span>}
      </span>
    </label>
  );
}

/** The pass mark and the proctoring switches. Used by the batch page and by the create-batch form. */
export function BatchSettingsFields({ value, canEdit, onChange }: { value: BatchSettings; canEdit: boolean; onChange: (fn: (d: BatchSettings) => BatchSettings) => void }) {
  const draft = value;
  const change = onChange;
  const setProctoring = (patch: Partial<BatchSettings["proctoring"]>) => change((d) => ({ ...d, proctoring: { ...d.proctoring, ...patch } }));
  return (
    <div className="space-y-5">
      <div>
        <label className="label">Passing mark (out of 100)</label>
        <input type="number" min={0} max={100} className="input-field w-32" disabled={!canEdit} value={draft.passMark}
          onChange={(e) => change((d) => ({ ...d, passMark: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) }))} />
        <p className="mt-1 text-xs text-gray-500">A candidate whose overall score is at or above this passes. 50 is the old "hire" line (3.0 out of 5).</p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-900">Strikes</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle disabled={!canEdit} checked={draft.proctoring.enforce} onChange={(v) => setProctoring({ enforce: v })} label="End the interview at the strike limit" help="Off: violations are still recorded for you to review, but nobody is removed." />
          <Toggle disabled={!canEdit} checked={draft.proctoring.showWarnings} onChange={(v) => setProctoring({ showWarnings: v })} label="Show warnings to the candidate" help="The yellow “Warning” banner during the test." />
        </div>
        <div>
          <label className="label">Strike limit</label>
          <input type="number" min={1} max={100000} className="input-field w-32" disabled={!canEdit || !draft.proctoring.enforce} value={draft.proctoring.maxStrikes}
            onChange={(e) => setProctoring({ maxStrikes: Math.max(1, Math.min(100000, Math.round(Number(e.target.value) || 1))) })} />
          <p className="mt-1 text-xs text-gray-500">Each violation adds a weight (a second person in the camera counts 1, leaving fullscreen 0.25).</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-900">Checks <span className="font-normal text-gray-500">(switch one off and it is not recorded and does not count)</span></p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROCTORING_CHECKS.map((c) => (
            <Toggle key={c.key} disabled={!canEdit} checked={draft.proctoring.checks[c.key]} onChange={(v) => setProctoring({ checks: { ...draft.proctoring.checks, [c.key]: v } })} label={c.label} help={c.help} />
          ))}
          <Toggle disabled={!canEdit} checked={draft.proctoring.allowMediaToggle} onChange={(v) => setProctoring({ allowMediaToggle: v })} label="Candidate can mute the mic or stop the video" help="Off removes the Mute and Stop Video buttons." />
        </div>
      </div>

    </div>
  );
}

export function BatchSettingsPanel({ settings, canEdit, running, onSave }: {
  settings: BatchSettings;
  canEdit: boolean;
  /** Candidates in the test right now. */
  running: number;
  onSave: (next: BatchSettings) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<BatchSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const incoming = useMemo(() => JSON.stringify(settings), [settings]);

  // Follow the server's copy until the admin starts editing.
  useEffect(() => { if (!dirty) setDraft(settings); }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (fn: (d: BatchSettings) => BatchSettings) => { setDraft((d) => fn(d)); setDirty(true); setSaved(false); };
  const off = PROCTORING_CHECKS.filter((c) => !settings.proctoring.checks[c.key]).length;

  const save = async () => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) { setDirty(false); setSaved(true); }
  };

  return (
    <div className="card p-5">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <div>
          <h2 className="text-base font-semibold text-gray-900">Test rules</h2>
          <p className="text-xs text-gray-500">
            Pass mark {settings.passMark}/100 · {settings.proctoring.enforce ? `ends at ${settings.proctoring.maxStrikes} strikes` : "nobody is removed for strikes"}{off > 0 ? ` · ${off} check${off === 1 ? "" : "s"} off` : ""}
          </p>
        </div>
        <span className="text-xs font-medium text-indigo-600">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-5 border-t border-gray-100 pt-4">
          <BatchSettingsFields value={draft} canEdit={canEdit} onChange={change} />

          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
              <p className="text-xs text-gray-500">
                {running > 0 ? `${running} candidate${running === 1 ? " is" : "s are"} taking the test now. Saved changes reach them within about 15 seconds.` : "Applies to everyone in this batch, including people who have not started yet."}
              </p>
              <div className="flex items-center gap-3">
                {saved && !dirty && <span className="text-xs font-medium text-green-600">Saved</span>}
                {dirty && <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setDraft(settings); setDirty(false); }}>Discard</button>}
                <button type="button" className="btn-primary" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save rules"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
