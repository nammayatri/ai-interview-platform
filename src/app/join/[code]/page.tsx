"use client";

// Public join page for a batch: opens for registration shortly before the start time. The candidate enters their
// details (and their Part A solution when the session has a Part A stage), then waits in the interview lobby, which
// holds the "Start" button until the start time.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { formatCountdown } from "@/lib/countdown";
import { LIMITS } from "@/lib/runbook";

interface PublicBatch {
  name: string; orgName: string; phase: "not_open" | "open" | "live" | "closed";
  opensAt: string; startsAt: string; closesAt: string; serverNow: string;
  requiresPartA: boolean; durationMin: number; stageLabels: string[];
}
interface Saved { url: string; name: string }

const MAX_CODE_FILE_BYTES = 300 * 1024;
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const storageKey = `join:${code}`;
  const [info, setInfo] = useState<PublicBatch | null>(null);
  const [loadError, setLoadError] = useState("");
  const [offsetMs, setOffsetMs] = useState(0);
  const [, setTick] = useState(0);
  const [saved, setSaved] = useState<Saved | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [resume, setResume] = useState<File | null>(null);
  const [partaCode, setPartaCode] = useState("");
  const [codeNote, setCodeNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // "email": ask for the email first; a registered one goes straight to its interview. "register": not found, show the form.
  const [step, setStep] = useState<"email" | "register">("email");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const resumeInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/join/${code}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(data.error || "This link is not valid."); return; }
      setLoadError("");
      setInfo(data);
      setOffsetMs(new Date(data.serverNow).getTime() - Date.now());
    } catch {
      // keep what we have; the next poll tries again
    }
  }, [code]);

  useEffect(() => {
    load();
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setSaved(JSON.parse(raw));
    } catch { /* private mode: no saved registration */ }
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    const poll = setInterval(load, 20000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [load, storageKey]);

  const now = Date.now() + offsetMs;
  const opensAt = info ? new Date(info.opensAt).getTime() : 0;
  const startsAt = info ? new Date(info.startsAt).getTime() : 0;
  const closesAt = info ? new Date(info.closesAt).getTime() : 0;
  // The server's word wins for a manual close; otherwise the live clock decides.
  const phase: PublicBatch["phase"] | null = !info ? null
    : info.phase === "closed" && now <= closesAt && now >= opensAt ? "closed"
    : now < opensAt ? "not_open" : now < startsAt ? "open" : now <= closesAt ? "live" : "closed";

  const loadCodeFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CODE_FILE_BYTES) return setCodeNote(`${file.name} is larger than 300 KB. Please choose your solution file.`);
    const text = await file.text();
    if (text.includes("\u0000")) return setCodeNote(`${file.name} is not a text file.`);
    if (!text.trim()) return setCodeNote(`${file.name} is empty.`);
    setPartaCode(text.slice(0, LIMITS.codeChars));
    setCodeNote(text.length > LIMITS.codeChars ? `${file.name} was cut to ${LIMITS.codeChars.toLocaleString()} characters.` : `Loaded ${file.name}.`);
  };

  const goToInterview = (url: string, who: string) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ url, name: who })); } catch { /* ignore */ }
    window.location.href = url;
  };

  // Step 1: the email. Registered here already: straight back to the same interview. Otherwise the details form.
  const checkEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginBusy) return;
    setLoginError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setLoginError("Enter a valid email address."); return; }
    setLoginBusy(true);
    try {
      const res = await fetch(`/api/join/${code}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) { goToInterview(data.url, data.name || email.trim()); return; }
      if (res.status === 404 && data.registered === false) {
        if (phase === "closed") setLoginError("No registration found for this email, and entry for this session is closed.");
        else setStep("register");
        return;
      }
      setLoginError(data.error || "Could not check your email. Please try again.");
    } catch {
      setLoginError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoginBusy(false);
    }
  };

  const emailCard = (
    <form onSubmit={checkEmail} className="card space-y-4 p-6" noValidate>
      <h2 className="text-base font-semibold text-gray-900">{phase === "closed" ? "Already started? Continue" : "Enter your email"}</h2>
      <p className="text-sm text-gray-600">{phase === "closed" ? "Enter the email you registered with to continue your interview." : "If you have registered already you will go straight back to your interview. If not, you will be asked for your details."}</p>
      <div>
        <label className="label" htmlFor="j-email0">Email</label>
        <input id="j-email0" type="email" className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} autoFocus />
      </div>
      {loginError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{loginError}</p>}
      <button type="submit" disabled={loginBusy} className="btn-primary w-full py-2.5">{loginBusy ? "Checking…" : "Continue"}</button>
    </form>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info || busy) return;
    setFieldErrors({}); setFormError(""); setNotice("");
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = "Enter your full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Enter a valid email address";
    if (phone.replace(/\D/g, "").length < 7) errs.phone = "Enter a valid phone number";
    if (!resume) errs.resume = "Upload your resume";
    if (info.requiresPartA && !partaCode.trim()) errs.partaCode = "Paste your Part A solution";
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("email", email.trim());
      fd.append("phone", phone.trim());
      fd.append("resume", resume as File);
      if (info.requiresPartA) fd.append("partaCode", partaCode);
      const res = await fetch(`/api/join/${code}/register`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      // 201: registered. 200 with existing: the same person registered before, so they are simply let back in.
      if ((res.status === 201 || (res.ok && data.existing)) && data.url) {
        goToInterview(data.url, data.name || name.trim());
        return;
      }
      if (data.fields) setFieldErrors(data.fields);
      if (data.duplicate) setNotice(data.error);
      else setFormError(data.error || "Could not complete your registration. Please try again.");
      if (res.status === 403 || res.status === 410) load();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </div>
  );

  if (loadError) {
    return shell(
      <div className="card p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900">Link not available</h1>
        <p className="mt-2 text-sm text-gray-600">{loadError}</p>
      </div>
    );
  }
  if (!info || !phase) {
    return shell(<div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>);
  }

  const header = (
    <div className="mb-6 text-center">
      {info.orgName && <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{info.orgName}</p>}
      <h1 className="mt-1 text-2xl font-bold text-gray-900">{info.name}</h1>
      <p className="mt-1 text-sm text-gray-600">{info.durationMin} minute AI interview · {info.stageLabels.join(" · ")}</p>
      <p className="mt-1 text-sm text-gray-600">Starts {when(info.startsAt)}</p>
    </div>
  );

  if (phase === "closed") {
    return shell(
      <>
        {header}
        <div className="card p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">Registration is closed</h2>
          <p className="mt-2 text-sm text-gray-600">Entry for this session is over. If you had already started your interview, you can continue below. Otherwise please contact the organiser.</p>
          {saved && <a href={saved.url} className="btn-primary mt-5 inline-block">Continue as {saved.name}</a>}
        </div>
        <div className="mt-5">{emailCard}</div>
      </>
    );
  }

  if (phase === "not_open") {
    return shell(
      <>
        {header}
        <div className="card p-8 text-center">
          <p className="text-sm text-gray-600">Registration opens in</p>
          <p className="mt-1 font-mono text-4xl font-semibold text-gray-900">{formatCountdown(opensAt - now)}</p>
          <p className="mt-3 text-sm text-gray-600">at {when(info.opensAt)}. Keep this page open, the form appears here automatically.</p>
        </div>
      </>
    );
  }

  const err = (k: string) => fieldErrors[k] && <p className="mt-1 text-xs text-red-600">{fieldErrors[k]}</p>;
  const banner = phase === "open" ? (
    <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-center">
      <p className="text-xs uppercase tracking-wider text-blue-700">The test starts in</p>
      <p className="font-mono text-3xl font-semibold text-blue-900">{formatCountdown(startsAt - now)}</p>
      <p className="mt-1 text-xs text-blue-800">Register now. You will wait in the lobby and can enter when the countdown ends.</p>
    </div>
  ) : (
    <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
      <p className="text-sm font-medium text-emerald-800">The test has started. Register now to enter.</p>
      <p className="mt-0.5 text-xs text-emerald-700">Entry closes in {formatCountdown(closesAt - now)}.</p>
    </div>
  );

  return shell(
    <>
      {header}
      {banner}
      {saved && step === "email" && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-sm text-gray-700">You already registered on this device as <span className="font-medium">{saved.name}</span>.</p>
          <a href={saved.url} className="btn-primary shrink-0">Continue</a>
        </div>
      )}
      {step === "email" ? emailCard : (
      <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
        <h2 className="text-base font-semibold text-gray-900">Your details</h2>
        <p className="-mt-2 text-sm text-gray-600">No registration found for {email.trim()}. Fill in your details to register. <button type="button" className="text-indigo-600 hover:text-indigo-800" onClick={() => { setStep("email"); setLoginError(""); }}>Use a different email</button></p>
        <div>
          <label className="label" htmlFor="j-name">Full name</label>
          <input id="j-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
          {err("name")}
        </div>
        <div>
          <label className="label" htmlFor="j-email">Email</label>
          <input id="j-email" type="email" className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} />
          {err("email")}
        </div>
        <div>
          <label className="label" htmlFor="j-phone">Phone number</label>
          <input id="j-phone" type="tel" className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={25} />
          {err("phone")}
        </div>
        <div>
          <label className="label">Resume <span className="font-normal text-gray-400">(PDF, DOCX or TXT, up to 10 MB)</span></label>
          <input ref={resumeInput} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => { setResume(e.target.files?.[0] || null); setFieldErrors((f) => ({ ...f, resume: "" })); }} />
          <button type="button" onClick={() => resumeInput.current?.click()} className="btn-secondary w-full text-left">
            {resume ? resume.name : "Choose your resume"}
          </button>
          {err("resume")}
        </div>
        {info.requiresPartA && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="label !mb-0" htmlFor="j-code">Your Part A solution <span className="text-gray-400 font-normal">({partaCode.length.toLocaleString()} / {LIMITS.codeChars.toLocaleString()})</span></label>
              <button type="button" onClick={() => codeInput.current?.click()} className="text-xs text-indigo-600 hover:text-indigo-800">Choose a file</button>
              <input ref={codeInput} type="file" className="hidden" accept=".py,.java,.cpp,.cc,.c,.h,.js,.ts,.go,.rs,.kt,.swift,.rb,.cs,.php,.scala,.txt,text/*" onChange={(e) => { loadCodeFile(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            <textarea id="j-code" className="input-field mt-1.5 font-mono text-xs" rows={12} spellCheck={false} value={partaCode}
              onChange={(e) => { setCodeNote(""); setPartaCode(e.target.value.slice(0, LIMITS.codeChars)); }}
              placeholder="Paste the code you wrote for Part A. The interview will ask you about it." />
            {codeNote && <p className="mt-1 text-xs text-gray-600">{codeNote}</p>}
            {err("partaCode")}
          </div>
        )}
        {notice && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}
        {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{formError}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">{busy ? "Registering…" : phase === "live" ? "Register and enter" : "Register"}</button>
        <p className="text-center text-xs text-gray-500">You will need a working camera, microphone and screen sharing. You can check them in the lobby.</p>
      </form>
      )}
    </>
  );
}
