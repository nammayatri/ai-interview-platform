"use client";

// Client state for the DSA Review room. The client never decides a phase transition:
// it only displays what the server reports and reacts to it.
import { useCallback, useEffect, useRef, useState } from "react";

export interface CandidatePhase {
  phaseKey: "dsa" | "puzzle";
  status: "pending" | "active" | "completed" | "skipped";
  budgetMin: number | null;
  startedAt: string | null;
  endedAt: string | null;
  problemTitle?: string;
  runbook?: { statementMd: string };
  selected?: { title: string; runbook: { statementMd: string } };
}

export interface CandidateSubmission {
  id: string;
  problemTitle: string;
  language: string;
  code: string;
  outcome: "passed" | "partial" | "failed";
  isPrimary: boolean;
}

export interface PhaseSnapshot {
  key: "dsa" | "puzzle" | null;
  elapsedMin: number;
  budgetMin: number;
  at: number; // client time the snapshot was taken
}

export interface PhaseInfoFromServer {
  key: "dsa" | "puzzle" | null;
  status: string;
  elapsedMin: number;
  budgetMin: number;
  remainingTotalMin: number;
}

export interface PhaseTransitionFromServer {
  from: "dsa" | "puzzle";
  to: "dsa" | "puzzle" | null;
  reason: string;
  /** true when the turn that carried this transition already was the new phase's opening turn */
  opened: boolean;
}

const POLL_MS = 60_000;

export function useDsaRoom({ interviewId, tokenRef, enabled }: { interviewId: string; tokenRef: React.MutableRefObject<string>; enabled: boolean }) {
  const [phases, setPhases] = useState<CandidatePhase[]>([]);
  const [submissions, setSubmissions] = useState<CandidateSubmission[]>([]);
  const [snapshot, setSnapshot] = useState<PhaseSnapshot | null>(null);
  const [scratchpad, setScratchpadState] = useState("");
  const scratchpadRef = useRef("");
  const activeKeyRef = useRef<string | null>(null);
  const [, setTick] = useState(0);

  const setScratchpad = useCallback((v: string) => {
    scratchpadRef.current = v;
    setScratchpadState(v);
  }, []);

  /** Loads phases/submissions from an interview GET response. Returns the active phase key. */
  const load = useCallback((interview: any, opts?: { initialScratchpad?: boolean }) => {
    const ph: CandidatePhase[] = Array.isArray(interview?.phases) ? interview.phases : [];
    setPhases(ph);
    setSubmissions(Array.isArray(interview?.submissions) ? interview.submissions : []);
    if (opts?.initialScratchpad && typeof interview?.scratchpad === "string") {
      scratchpadRef.current = interview.scratchpad;
      setScratchpadState(interview.scratchpad);
    }
    const active = ph.find((p) => p.status === "active") || null;
    activeKeyRef.current = active ? active.phaseKey : null;
    if (active && active.startedAt && active.budgetMin !== null) {
      setSnapshot({ key: active.phaseKey, elapsedMin: (Date.now() - new Date(active.startedAt).getTime()) / 60000, budgetMin: active.budgetMin, at: Date.now() });
    } else {
      setSnapshot(null);
    }
    return active ? active.phaseKey : null;
  }, []);

  const refresh = useCallback(async () => {
    const t = tokenRef.current ? `?token=${tokenRef.current}` : "";
    const res = await fetch(`/api/interview/${interviewId}${t}`);
    if (!res.ok) return null;
    const interview = await res.json();
    const prev = activeKeyRef.current;
    const key = load(interview);
    return { interview, activeKey: key, changed: prev !== key };
  }, [interviewId, tokenRef, load]);

  const applyServerPhase = useCallback((info: PhaseInfoFromServer | undefined) => {
    if (!info) return;
    activeKeyRef.current = info.key;
    setSnapshot(info.key ? { key: info.key, elapsedMin: info.elapsedMin, budgetMin: info.budgetMin, at: Date.now() } : null);
  }, []);

  // 1s tick so the phase timer re-renders
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  const active = phases.find((p) => p.status === "active") || null;
  const dsaPhase = phases.find((p) => p.phaseKey === "dsa") || null;
  const phaseRemainingSec = snapshot && snapshot.budgetMin > 0
    ? Math.max(0, Math.round(snapshot.budgetMin * 60 - (snapshot.elapsedMin * 60 + (Date.now() - snapshot.at) / 1000)))
    : null;

  return { phases, submissions, snapshot, active, dsaPhase, phaseRemainingSec, scratchpad, scratchpadRef, setScratchpad, load, refresh, applyServerPhase, activeKeyRef, pollMs: POLL_MS };
}
