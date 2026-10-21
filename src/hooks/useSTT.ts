"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isPauseRequest } from "@/lib/pause-detect";
import { TurnBuffer } from "@/lib/turn-buffer";
import { startPcmCapture, type PcmCapture } from "@/lib/pcm-capture";
import { PushToTalk, type TalkState } from "@/lib/push-to-talk";

export type STTProviderName = "deepgram" | "browser";

interface UseSTTOptions {
  providers: STTProviderName[];
  interviewId: string;
  token: string;
  isAISpeaking: React.MutableRefObject<boolean>;
  isStarted: boolean;
  isEnding: React.MutableRefObject<boolean>;
  mediaStream: React.MutableRefObject<MediaStream | null>;
  silenceDelayMs?: number;
  audioFormat?: "webm" | "pcm16"; // webm (MediaRecorder) for Deepgram/Soniox, pcm16 (16 kHz raw) for Voxtral
  manualMode?: boolean; // candidate taps "Done" instead of auto-send after silence
  muted?: boolean; // microphone muted: stop listening and transcribing at once, resume when unmuted
  onPauseRequest?: () => void; // candidate asked for a moment ("give me a minute")
  onInterim: (text: string) => void;
  onComplete: (text: string) => void;
  onInterrupt?: () => void; // called when candidate speaks during AI speech — stops TTS
}

interface UseSTTReturn {
  connected: boolean;
  status: "connecting" | "live" | "reconnecting" | "failed"; // failed = no way to hear the candidate; show the typing fallback
  reconnect: () => void; // user-triggered immediate retry
  everConnected: boolean;
  provider: STTProviderName | null;
  start: () => void;
  stop: () => void;
  submitNow: () => void; // send what the candidate has said so far, immediately
  talkState: TalkState; // manual mode: idle | listening | sending
  toggleTalk: () => void; // manual mode: start listening / stop and send (button + Ctrl+M)
}

export function useSTT(options: UseSTTOptions): UseSTTReturn {
  const { providers, interviewId, token, isAISpeaking, isStarted, isEnding, mediaStream, silenceDelayMs = 6000, audioFormat = "webm", manualMode = false, muted = false, onPauseRequest, onInterim, onComplete, onInterrupt } = options;
  const onInterruptRef = useRef(onInterrupt);
  onInterruptRef.current = onInterrupt;
  const audioFormatRef = useRef(audioFormat);
  audioFormatRef.current = audioFormat;
  const pcmRef = useRef<PcmCapture | null>(null);
  const manualModeRef = useRef(manualMode);
  manualModeRef.current = manualMode;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const silenceDelayRef = useRef(silenceDelayMs);
  silenceDelayRef.current = silenceDelayMs;
  const onPauseRef = useRef(onPauseRequest);
  onPauseRef.current = onPauseRequest;

  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [activeProvider, setActiveProvider] = useState<STTProviderName | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting" | "failed">("connecting");
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReconnectRef = useRef<() => void>(() => {});

  const dgSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const browserRecRef = useRef<any>(null);
  const keepAliveRef = useRef<NodeJS.Timeout | null>(null);
  const stoppedRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const reconnectingRef = useRef(false); // #6: prevent health monitor racing with reconnect

  const onInterimRef = useRef(onInterim);
  const onCompleteRef = useRef(onComplete);
  const startBrowserRef = useRef<() => boolean | undefined>();
  onInterimRef.current = onInterim;
  onCompleteRef.current = onComplete;

  // ─── Buffer + Trigger Logic ───────────────────────────────────────────
  // All turn-taking timing lives in TurnBuffer (src/lib/turn-buffer.ts, unit-tested).

  const turnRef = useRef<TurnBuffer | null>(null);
  if (!turnRef.current) {
    turnRef.current = new TurnBuffer({
      getDelayMs: () => silenceDelayRef.current,
      isManual: () => manualModeRef.current,
      canFlush: () => !stoppedRef.current && !isEnding.current,
      onFlush: (full) => {
        // A short "give me a moment" is still sent (so the AI can acknowledge it) but also tells
        // the room to stop nudging the candidate.
        if (isPauseRequest(full)) onPauseRef.current?.();
        onCompleteRef.current(full);
      },
    });
  }
  const turn = turnRef.current;

  // #1, #20: clear buffer on stop/restart to prevent stale speech leaking + cancel the silence timer
  const clearBuffer = useCallback(() => { turn.clear(); }, [turn]);

  const handleFinalText = useCallback((text: string, _speechFinal = false) => {
    if (stoppedRef.current) return;
    turn.addFinal(text);
  }, [turn]);

  // What the candidate sees while speaking: everything finalized so far this turn plus the words still in progress.
  // Showing only the in-progress part made earlier sentences vanish at every pause and reappear when the turn was sent.
  const handleInterimText = useCallback((text: string) => {
    turn.setInterim(text);
    onInterimRef.current([turn.getBuffer(), text.trim()].filter(Boolean).join(" "));
  }, [turn]);

  // "Done" button: send everything said so far (including text still shown as interim) right now.
  const submitNow = useCallback(() => {
    if (stoppedRef.current || isEnding.current) return;
    if (turn.submitNow()) onInterimRef.current("");
  }, [turn, isEnding]);

  // ─── Manual mode: tap to start listening, tap again to stop and send ──────
  const [talkState, setTalkState] = useState<TalkState>("idle");
  const talkRef = useRef<PushToTalk | null>(null);
  if (!talkRef.current) {
    talkRef.current = new PushToTalk({
      graceMs: 700, // let the recogniser finish the last words before sending
      onChange: setTalkState,
      onStart: () => {
        turn.clear(); // drop anything stale from before the candidate pressed the button
        onInterimRef.current("");
        if (isAISpeaking.current) onInterruptRef.current?.(); // speaking over the AI cuts it off
      },
      onSubmit: () => {
        if (stoppedRef.current || isEnding.current) return;
        if (turn.submitNow()) onInterimRef.current("");
      },
    });
  }
  const talk = talkRef.current;
  const toggleTalk = useCallback(() => {
    if (!manualModeRef.current || stoppedRef.current || isEnding.current || mutedRef.current) return;
    talk.toggle();
  }, [talk, isEnding]);

  // Leaving manual mode (or unmounting) abandons any half-finished turn
  useEffect(() => {
    if (!manualMode) talk.reset();
    return () => { talk.reset(); };
  }, [manualMode, talk]);

  // ─── Deepgram: single connection for entire session ──────────────────

  const startDeepgram = useCallback(async () => {
    if (!mediaStream.current) {
      console.error("[STT:deepgram] No media stream available");
      return false;
    }
    if (stoppedRef.current) return false;

    // Cleanup previous
    if (dgSocketRef.current) { try { dgSocketRef.current.close(); } catch {} }
    if (mediaRecorderRef.current?.state === "recording") { try { mediaRecorderRef.current.stop(); } catch {} }
    if (pcmRef.current) { pcmRef.current.stop(); pcmRef.current = null; }
    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/stt-ws?token=${token}`;

    try {
      const dgSocket = new WebSocket(wsUrl);
      dgSocketRef.current = dgSocket;

      const connectTime = Date.now();
      dgSocket.onopen = () => {
        // Only reset reconnect count if previous connection lasted >5s (stable)
        // Rapid connect→disconnect loops should still count toward the 5-retry limit
        reconnectingRef.current = false;
        setConnected(true);
        setEverConnected(true);
        setActiveProvider("deepgram");
        setStatus("live");
        // Deepgram is back: drop the browser fallback so the same speech is not transcribed twice
        if (browserRecRef.current) {
          if (browserRecRef.current._echoGuard) clearInterval(browserRecRef.current._echoGuard);
          try { browserRecRef.current.abort(); } catch {}
          browserRecRef.current = null;
        }
        console.log("[STT] Connected via WebSocket proxy");

        const audioTracks = mediaStream.current!.getAudioTracks();
        if (audioTracks.length === 0) return;
        const audioStream = new MediaStream(audioTracks);

        if (audioFormatRef.current === "pcm16") {
          // Voxtral wants raw 16 kHz PCM16, not a WebM container
          startPcmCapture(audioStream, (pcm) => {
            if (dgSocket.readyState === WebSocket.OPEN) dgSocket.send(pcm);
          }).then((cap) => {
            if (stoppedRef.current || dgSocket.readyState !== WebSocket.OPEN) { cap.stop(); return; }
            pcmRef.current = cap;
          }).catch((err) => {
            console.error("[STT] PCM capture failed:", err);
            try { dgSocket.close(); } catch {}
          });
        } else {
          const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
          const mimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m));

          let recorder: MediaRecorder;
          try {
            recorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
          } catch {
            recorder = new MediaRecorder(audioStream);
          }
          mediaRecorderRef.current = recorder;
          recorder.ondataavailable = (e) => {
            if (dgSocket.readyState === WebSocket.OPEN && e.data.size > 0) dgSocket.send(e.data);
          };
          recorder.start(250);
        }

        // KeepAlive every 3s — must be TEXT frame
        keepAliveRef.current = setInterval(() => {
          if (dgSocket.readyState === WebSocket.OPEN) {
            dgSocket.send(JSON.stringify({ type: "KeepAlive" }));
          } else {
            if (keepAliveRef.current) clearInterval(keepAliveRef.current);
          }
        }, 3000);
      };

      dgSocket.onmessage = async (msg) => {
        let raw: string;
        if (msg.data instanceof Blob) raw = await msg.data.text();
        else raw = msg.data;

        let data: any;
        try { data = JSON.parse(raw); } catch { return; }

        // Muted: nothing that arrives is transcribed, shown or sent
        if (mutedRef.current || stoppedRef.current) return;

        // Manual mode: only listen between pressing start and stop
        if (manualModeRef.current && !talk.isAccepting()) return;

        // If candidate speaks during AI speech — interrupt (stop TTS, let them talk)
        if (isAISpeaking.current) {
          // Check if this is real speech (not just noise)
          const hasRealText = data.type === "Results" && (() => { const t = (data.channel?.alternatives?.[0]?.transcript || "").trim(); return t.length > 6 && t.split(/\s+/).length >= 2; })();
          if (hasRealText && onInterruptRef.current) {
            onInterruptRef.current(); // stops TTS audio, text stays on screen
            // Push interrupt text into final buffer so silence timer starts.
            // Without this, text shows on screen but never triggers AI response
            // because candidate already finished speaking and no more STT results come.
            const interruptText = data.channel.alternatives[0].transcript;
            handleFinalText(interruptText, false);
            handleInterimText("");
          }
          return;
        }

        // UtteranceEnd — server detected speech ended. Don't fire immediately;
        // instead reset the silence timer so the candidate still gets the full
        // delay (4s) to continue speaking. This prevents premature AI triggers
        // from Soniox's aggressive semantic endpointing (~1s).
        if (data.type === "UtteranceEnd") {
          if (!stoppedRef.current) turn.utteranceEnd();
          return;
        }

        if (data.type !== "Results") return;
        const alt = data.channel?.alternatives?.[0];
        if (!alt) return;

        const text = alt.transcript || "";
        const isFinal = data.is_final;
        const speechFinal = data.speech_final;

        if (isFinal && text) {
          handleFinalText(text, speechFinal);
          handleInterimText("");
        } else if (!isFinal && text) {
          handleInterimText(text);
          // Interim = user is still speaking, postpone the silence trigger. If text is already
          // buffered, restart the countdown so we never wait forever for a final that may not come.
          if (text.trim()) turn.interimActivity();
        }
      };

      dgSocket.onerror = () => console.error("[STT:deepgram] WebSocket error");

      dgSocket.onclose = (e) => {
        // A socket that was replaced or closed on purpose (mute, restart) must not touch the new one's state or retry
        if (dgSocketRef.current !== dgSocket) return;
        const connectionDuration = Date.now() - connectTime;
        console.log(`[STT] WebSocket disconnected code=${e.code} after ${Math.round(connectionDuration / 1000)}s`);
        setConnected(false);
        if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
        // Only reset reconnect count if connection lasted >5s (stable)
        if (connectionDuration > 5000) reconnectCountRef.current = 0;

        // Never give up: keep retrying with backoff (the candidate may be on a flaky network)
        if (!stoppedRef.current && !isEnding.current) scheduleReconnectRef.current();
      };

      return true;
    } catch {
      if (!stoppedRef.current && !isEnding.current) scheduleReconnectRef.current();
      return false;
    }
  }, [token, isAISpeaking, isEnding, mediaStream, handleFinalText, handleInterimText, clearBuffer]);

  // ─── Browser Speech API (fallback only) ───────────────────────────────

  const startBrowser = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return false;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-IN";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setConnected(true);
        setEverConnected(true);
        setActiveProvider("browser");
        setStatus("live");
      };

      recognition.onresult = (event: any) => {
        if (isAISpeaking.current || mutedRef.current) return;
        if (manualModeRef.current && !talk.isAccepting()) return; // manual mode: only while listening
        const result = event.results[event.results.length - 1];
        const text = result[0].transcript;
        if (!result.isFinal) { handleInterimText(text); return; }
        handleInterimText("");
        handleFinalText(text);
      };

      recognition.onerror = (event: any) => {
        if (event.error === "aborted") return;
        if (event.error === "not-allowed" || event.error === "service-not-available") {
          console.error("[STT:browser] Fatal:", event.error);
        }
      };

      recognition.onend = () => {
        setConnected(false);
        if (stoppedRef.current || isAISpeaking.current) return;
        setTimeout(() => {
          if (stoppedRef.current || isAISpeaking.current) return;
          try { recognition.start(); } catch {}
        }, 300);
      };

      recognition.start();
      browserRecRef.current = recognition; // #3: store ref for cleanup

      let wasAISpeaking = false;
      const echoGuard = setInterval(() => {
        if (stoppedRef.current) { clearInterval(echoGuard); return; }
        if (isAISpeaking.current && !wasAISpeaking) {
          wasAISpeaking = true;
          try { recognition.abort(); } catch {}
        } else if (!isAISpeaking.current && wasAISpeaking) {
          wasAISpeaking = false;
          setTimeout(() => {
            if (isAISpeaking.current || stoppedRef.current) return;
            try { recognition.start(); } catch {}
          }, 500);
        }
      }, 500);

      recognition._echoGuard = echoGuard;
      return true;
    } catch {
      return false;
    }
  }, [isAISpeaking, isEnding, handleFinalText, handleInterimText, talk]);
  startBrowserRef.current = startBrowser;

  // Reconnect with backoff (1s, 2s, 4s, 8s, then every 15s) until it works or the interview ends.
  // After 3 failed attempts the browser's own speech recogniser covers the gap; if neither works the
  // status becomes "failed" so the room can tell the candidate to type.
  scheduleReconnectRef.current = () => {
    if (reconnectTimerRef.current || stoppedRef.current) return;
    reconnectCountRef.current++;
    const n = reconnectCountRef.current;
    if (n >= 3 && !browserRecRef.current) {
      const ok = n === 3 ? startBrowserRef.current?.() : false;
      setStatus(ok ? "live" : "failed");
    } else {
      setStatus(browserRecRef.current ? "live" : "reconnecting");
    }
    const delay = Math.min(1000 * 2 ** (n - 1), 15000);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (stoppedRef.current || isEnding.current) return;
      startDeepgram();
    }, delay);
  };

  const reconnect = useCallback(() => {
    if (stoppedRef.current || isEnding.current) return;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    const rs = dgSocketRef.current?.readyState;
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;
    reconnectCountRef.current = 0;
    setStatus("reconnecting");
    startDeepgram();
  }, [startDeepgram, isEnding]);

  // ─── Public API ───────────────────────────────────────────────────────

  const start = useCallback(() => {
    if (mutedRef.current) return; // unmuting starts listening again
    stoppedRef.current = false;
    reconnectCountRef.current = 0; // #5: only reset here, not in onopen
    reconnectingRef.current = false;
    setStatus("connecting");
    clearBuffer(); // #1: clear stale buffer on start
    const first = providers[0] || "deepgram";
    console.log(`[STT] Starting (transport=${first}, backend configured on server)`);
    if (first === "deepgram") startDeepgram();
    else startBrowser();
  }, [providers, startDeepgram, startBrowser, clearBuffer]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    clearBuffer(); // #1, #2: clear buffer + cancel silence timer

    // Deepgram cleanup
    const oldSocket = dgSocketRef.current;
    dgSocketRef.current = null; // a later start() may already own a new socket by the time this one closes
    if (oldSocket?.readyState === WebSocket.OPEN) {
      try { oldSocket.send(JSON.stringify({ type: "CloseStream" })); } catch {}
      setTimeout(() => { try { oldSocket.close(); } catch {} }, 500);
    } else {
      try { oldSocket?.close(); } catch {}
    }
    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
    if (mediaRecorderRef.current?.state !== "inactive") { try { mediaRecorderRef.current?.stop(); } catch {} }
    if (pcmRef.current) { pcmRef.current.stop(); pcmRef.current = null; }

    // #3: Browser fallback cleanup
    if (browserRecRef.current) {
      if (browserRecRef.current._echoGuard) clearInterval(browserRecRef.current._echoGuard);
      try { browserRecRef.current.abort(); } catch {}
      browserRecRef.current = null;
    }

    setConnected(false);
    setActiveProvider(null);
  }, [clearBuffer]);

  // ─── Mute: stop listening immediately, resume on unmute ──────────────────
  // Closing the socket and recorder (not just silencing the track) means nothing is captured, buffered or sent while muted.
  const wasMutedRef = useRef(false);
  const startFnRef = useRef(start);
  const stopFnRef = useRef(stop);
  startFnRef.current = start;
  stopFnRef.current = stop;
  useEffect(() => {
    if (muted) {
      wasMutedRef.current = true;
      if (isStarted) {
        stopFnRef.current();
        talk.reset();
        onInterimRef.current("");
      }
    } else if (wasMutedRef.current) {
      wasMutedRef.current = false;
      if (isStarted && !isEnding.current) startFnRef.current();
    }
  }, [muted, isStarted, talk, isEnding]);

  // ─── Health Monitor ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isStarted) return;
    const check = () => {
      if (stoppedRef.current || isEnding.current) return;
      if (!providers.includes("deepgram")) return;
      const open = dgSocketRef.current?.readyState === WebSocket.OPEN;
      if (!open && !reconnectTimerRef.current && dgSocketRef.current?.readyState !== WebSocket.CONNECTING) {
        console.log("[STT] Health check — socket not open, reconnecting...");
        scheduleReconnectRef.current();
      }
    };
    const monitor = setInterval(check, 8000);
    // Coming back online or returning to the tab: do not wait for the next tick
    const onBack = () => { if (document.visibilityState !== "hidden") reconnect(); };
    window.addEventListener("online", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      clearInterval(monitor);
      window.removeEventListener("online", onBack);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, [isStarted, isEnding, providers, reconnect]);

  // ─── beforeunload: graceful close ─────────────────────────────────────
  // #22: send CloseStream on tab close/navigate

  useEffect(() => {
    const handleUnload = () => {
      if (dgSocketRef.current?.readyState === WebSocket.OPEN) {
        try { dgSocketRef.current.send(JSON.stringify({ type: "CloseStream" })); } catch {}
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // ─── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => { stoppedRef.current = true; stop(); };
  }, [stop]);

  return { connected, status, reconnect, everConnected, provider: activeProvider, start, stop, submitNow, talkState, toggleTalk };
}
