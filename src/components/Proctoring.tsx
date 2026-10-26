"use client";

import { useEffect, useRef, useCallback } from "react";

interface ProctoringAlert {
  type: string;
  severity: string;
  message: string;
}

interface ProctoringProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  interviewId: string;
  enabled: boolean;
  onAlert: (alert: ProctoringAlert) => void;
  /** False for an event type whose check the batch switched off: nothing is shown or recorded. */
  isEventEnabled?: (type: string) => boolean;
  token?: string;
}

async function sendProctoringEvent(interviewId: string, type: string, severity: string, message: string, token?: string) {
  try {
    const res = await fetch("/api/proctor-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewId, type, severity, message, token }),
    });
    if (!res.ok) {
      console.error(`[Proctoring] Failed to save event ${type}: HTTP ${res.status}`, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error(`[Proctoring] Failed to send event ${type}:`, err);
  }
}

export default function Proctoring({ videoRef, interviewId, enabled, onAlert, isEventEnabled, token }: ProctoringProps) {
  const isEventEnabledRef = useRef(isEventEnabled);
  isEventEnabledRef.current = isEventEnabled;
  // faceLandmarkerRef removed — FaceLandmarker model no longer available on Google CDN
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const phoneCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastTabSwitchRef = useRef(0);
  const photoCountRef = useRef(0);
  const lastAlertTimeRef = useRef<Record<string, number>>({});

  const captureViolationPhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = photoCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    canvas.width = 480;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, 480, 360);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const formData = new FormData();
      formData.append("interviewId", interviewId);
      formData.append("type", "violation_photo");
      formData.append("severity", "info");
      formData.append("message", "Photo captured on violation");
      formData.append("photo", blob, "violation.webp");
      if (token) formData.append("token", token);
      fetch("/api/proctor-event", { method: "POST", body: formData }).catch(() => {});
    }, "image/webp", 0.5);
  }, [videoRef, interviewId, token]);

  const alert = useCallback(
    (type: string, severity: string, message: string) => {
      const now = Date.now();
      // Cooldowns tuned for Indian conditions — longer gaps between repeated alerts
      const cooldowns: Record<string, number> = {
        second_monitor: 300000,
        multiple_faces: 15000,   // 15s cooldown
        face_missing: 30000,     // 30s — bad lighting triggers this constantly
        eye_away: 30000,
        devtools_open: 60000,
        phone_detected: 60000,
        fullscreen_exit: 30000,  // 30s — OS popups can kick fullscreen repeatedly
        window_blur: 30000,      // 30s cooldown
        left_screen: 1,          // every departure is reported
        virtual_camera: 300000,
        copy_attempt: 20000,
        paste_attempt: 20000,
        screenshot_attempt: 10000,
      };
      const cooldown = cooldowns[type] ?? 5000;
      const lastTime = lastAlertTimeRef.current[type] || 0;
      if (now - lastTime < cooldown) return;
      lastAlertTimeRef.current[type] = now;

      if (isEventEnabledRef.current && !isEventEnabledRef.current(type)) return;
      onAlert({ type, severity, message });
      sendProctoringEvent(interviewId, type, severity, message, token);
      // Violation photo max 1 per 30s to prevent spam
      if (severity === "flag") {
        const lastPhoto = lastAlertTimeRef.current["_violation_photo"] || 0;
        if (now - lastPhoto > 30000) {
          lastAlertTimeRef.current["_violation_photo"] = now;
          captureViolationPhoto();
        }
      }
    },
    [onAlert, interviewId, token, captureViolationPhoto]
  );

  useEffect(() => {
    faceCanvasRef.current = document.createElement("canvas");
    photoCanvasRef.current = document.createElement("canvas");
    phoneCanvasRef.current = document.createElement("canvas");
  }, []);

  // Tab switch detection is now handled by the combined window focus loss detector below

  // Fullscreen exit detection — fires alert, InterviewRoom handles the mandatory re-enter prompt
  useEffect(() => {
    if (!enabled) return;
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        alert("fullscreen_exit", "flag", "Please stay in fullscreen mode during the interview");
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [enabled, alert]);

  // Leaving the interview screen (another tab, another app, minimised window). A browser cannot lock the screen or
  // stop Alt-Tab, so every departure longer than a moment is recorded as "left_screen" with how long it lasted and is
  // reported to the reviewer as possible plagiarism. The page is covered while away and a notice shows on return.
  useEffect(() => {
    if (!enabled) return;
    const MIN_AWAY_MS = 1500; // shorter than this is an OS notification or a click on the screen-share bar
    let awayStart = 0;
    let coverTimer: ReturnType<typeof setTimeout> | null = null;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    // Clicking the browser's own controls (the screen-share bar, mic/camera indicators, the share picker) moves the pointer
    // out of the page and takes focus. An app switch by keyboard does not. Such a short, pointer-led absence is not a departure.
    const CHROME_GRACE_MS = 10000;
    let pointerLeftAt = 0;
    let viaPointer = false;
    const onPointerLeave = () => { pointerLeftAt = Date.now(); };
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    const cover = document.createElement("div");
    cover.style.cssText = "position:fixed;inset:0;background:#0b0b10;z-index:2147483646;display:none;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:#fff;font:15px sans-serif;text-align:center;padding:24px";
    document.body.appendChild(cover);
    const show = (html: string) => { cover.innerHTML = html; cover.style.display = "flex"; };

    const leave = () => {
      if (awayStart) return;
      awayStart = Date.now();
      viaPointer = awayStart - pointerLeftAt < 1000 || !!(window as any).__sharePickerOpen;
      // Cover the page only once the absence is real. Dragging the browser's screen-share bar or a passing OS
      // notification takes focus for a moment and must not flash a black screen.
      showTimer = setTimeout(() => show("<div style='font-size:18px;font-weight:600'>Return to the interview</div><div style='opacity:.8'>Leaving this screen is recorded and reported to the reviewer.</div>"), viaPointer ? CHROME_GRACE_MS : MIN_AWAY_MS);
    };
    const back = () => {
      if (!awayStart) return;
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      const ms = Date.now() - awayStart;
      awayStart = 0;
      if (viaPointer && ms < CHROME_GRACE_MS) {
        cover.style.display = "none";
      } else if (ms >= MIN_AWAY_MS) {
        const secs = Math.max(1, Math.round(ms / 1000));
        alert("left_screen", "flag", `Left the interview screen for ${secs} s (switched tab or app). Reported as possible plagiarism.`);
        show("<div style='font-size:18px;font-weight:600;color:#fca5a5'>You left the interview screen</div><div style='opacity:.85'>This has been recorded and will be reported to the reviewer. Please stay on this screen.</div>");
        if (coverTimer) clearTimeout(coverTimer);
        coverTimer = setTimeout(() => { cover.style.display = "none"; }, 4000);
      } else {
        cover.style.display = "none";
      }
    };

    const onBlur = () => leave();
    const onFocus = () => back();
    // A hidden page means another tab or a minimised window, never the browser's own controls
    const onVisibility = () => { if (document.hidden) { leave(); viaPointer = false; } else if (document.hasFocus()) back(); };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    // Catches switches that fire no event (some OS shortcuts): focus is lost but blur never arrived.
    const poll = setInterval(() => { if (!document.hasFocus()) leave(); else back(); }, 1000);

    return () => {
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(poll);
      if (coverTimer) clearTimeout(coverTimer);
      if (showTimer) clearTimeout(showTimer);
      cover.remove();
    };
  }, [enabled, alert]);

  // Content protection: the problem, the AI's messages and any displayed code cannot be copied out.
  // Typing/pasting into the candidate's own input boxes stays allowed (pasting into the DSA scratchpad
  // is blocked in that component). A browser cannot truly stop OS screenshots; we detect the usual
  // shortcuts, hide the page briefly, and flag them. The watermark on the page identifies leaks.
  useEffect(() => {
    if (!enabled) return;
    const inEditable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
    };
    const blockCopy = (e: ClipboardEvent) => {
      if (inEditable(e.target)) return;
      e.preventDefault();
      alert("copy_attempt", "flag", "Copying interview content is not allowed");
    };
    const blockSelect = (e: Event) => { if (!inEditable(e.target)) e.preventDefault(); };
    const onScratchPaste = () => alert("paste_attempt", "flag", "Tried to paste into the code area");
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const cover = document.createElement("div");
    cover.style.cssText = "position:fixed;inset:0;background:#000;z-index:2147483647;display:none;align-items:center;justify-content:center;color:#fff;font:14px sans-serif";
    cover.textContent = "Screenshots are not allowed during the interview";
    document.body.appendChild(cover);
    const flashCover = () => {
      cover.style.display = "flex";
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { cover.style.display = "none"; }, 2500);
    };
    const onKey = (e: KeyboardEvent) => {
      const mac = (e.metaKey && e.shiftKey && ["3", "4", "5", "#", "$", "%"].includes(e.key));
      const win = e.key === "PrintScreen" || (e.metaKey && e.shiftKey && (e.key === "s" || e.key === "S"));
      if (mac || win) {
        e.preventDefault();
        flashCover();
        try { navigator.clipboard?.writeText(""); } catch {}
        alert("screenshot_attempt", "flag", "Screenshots are not allowed during the interview");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === "PrintScreen") { flashCover(); try { navigator.clipboard?.writeText(""); } catch {} } };
    document.addEventListener("copy", blockCopy);
    document.addEventListener("cut", blockCopy);
    document.addEventListener("selectstart", blockSelect);
    document.addEventListener("dragstart", blockSelect);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    const onScratchCopy = () => alert("copy_attempt", "flag", "Tried to copy from the code area");
    window.addEventListener("scratchpad-paste-blocked", onScratchPaste);
    window.addEventListener("scratchpad-copy-blocked", onScratchCopy);
    return () => {
      document.removeEventListener("copy", blockCopy);
      document.removeEventListener("cut", blockCopy);
      document.removeEventListener("selectstart", blockSelect);
      document.removeEventListener("dragstart", blockSelect);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("scratchpad-paste-blocked", onScratchPaste);
      window.removeEventListener("scratchpad-copy-blocked", onScratchCopy);
      if (hideTimer) clearTimeout(hideTimer);
      cover.remove();
    };
  }, [enabled, alert]);

  // Faint repeating watermark so any photographed screen can be traced to this interview.
  useEffect(() => {
    if (!enabled) return;
    const mark = document.createElement("div");
    const label = `ID ${interviewId.slice(0, 8)}`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='160'><text x='20' y='90' transform='rotate(-25 130 80)' fill='white' fill-opacity='0.06' font-size='16' font-family='sans-serif'>${label}</text></svg>`;
    mark.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:2147483000;background-image:url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
    document.body.appendChild(mark);
    return () => mark.remove();
  }, [enabled, interviewId]);

  // Second monitor / extended display detection
  useEffect(() => {
    if (!enabled) return;
    const checkMultipleScreens = () => {
      // Method 1: screen.isExtended (Chrome 93+)
      if ('isExtended' in window.screen && (window.screen as any).isExtended) {
        alert("second_monitor", "flag", "Extended display detected — please use a single screen");
        return;
      }
      // Method 2: Compare available screen size with window screen size
      // If available width is much larger than screen width, likely multiple monitors
      if (window.screen.availWidth > window.screen.width * 1.5) {
        alert("second_monitor", "flag", "Multiple screens detected");
        return;
      }
      // Method 3: Window Segments API (newer browsers)
      if ('getWindowSegments' in window.visualViewport!) {
        try {
          const segments = (window.visualViewport as any).getWindowSegments();
          if (segments && segments.length > 1) {
            alert("second_monitor", "flag", "Multiple display segments detected");
          }
        } catch {}
      }
    };
    // Check on mount and on resize (monitors added/removed trigger resize)
    checkMultipleScreens();
    window.addEventListener("resize", checkMultipleScreens);
    return () => window.removeEventListener("resize", checkMultipleScreens);
  }, [enabled, alert]);

  // DevTools detection
  useEffect(() => {
    if (!enabled) return;
    let devtoolsOpen = false;

    const checkDevTools = () => {
      // Method 1: Window size difference — DevTools changes outerHeight/innerHeight ratio
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 200;

      if (widthThreshold || heightThreshold) {
        if (!devtoolsOpen) {
          devtoolsOpen = true;
          alert("devtools_open", "flag", "Developer tools detected — please close them");
        }
      } else {
        devtoolsOpen = false;
      }
    };

    const interval = setInterval(checkDevTools, 5000);

    // Also block right-click context menu
    const blockContext = (e: MouseEvent) => {
      e.preventDefault();
      alert("devtools_open", "info", "Right-click disabled during interview");
    };
    document.addEventListener("contextmenu", blockContext);

    // Block F12 and Ctrl+Shift+I/J/C
    const blockShortcuts = (e: KeyboardEvent) => {
      if (e.key === "F12" ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I","J","C","i","j","c"].includes(e.key))) {
        e.preventDefault();
        alert("devtools_open", "info", "Developer shortcuts blocked");
      }
    };
    document.addEventListener("keydown", blockShortcuts);

    return () => {
      clearInterval(interval);
      document.removeEventListener("contextmenu", blockContext);
      document.removeEventListener("keydown", blockShortcuts);
    };
  }, [enabled, alert]);

  // Face detection using MediaPipe FaceDetector (BlazeFace)
  // Works on ALL browsers — detects face count + bounding box position
  // Chrome native FaceDetector used as immediate fallback while MediaPipe loads
  const nativeFaceDetectorRef = useRef<any>(null);
  const mediaPipeDetectorRef = useRef<any>(null);
  const detectionFailedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // Chrome native FaceDetector (instant, no download)
    if ("FaceDetector" in window) {
      try {
        nativeFaceDetectorRef.current = new (window as any).FaceDetector({ maxDetectedFaces: 5, fastMode: true });
        console.log("[Proctoring] Chrome FaceDetector available");
      } catch { nativeFaceDetectorRef.current = null; }
    }

    // MediaPipe FaceDetector for all browsers (1MB model, works everywhere)
    let cancelled = false;
    (async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const { FaceDetector, FilesetResolver } = vision;
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
        );
        if (cancelled) return;
        // Try GPU first, then CPU
        let loaded = false;
        for (const delegate of ["GPU", "CPU"] as const) {
          try {
            mediaPipeDetectorRef.current = await FaceDetector.createFromOptions(filesetResolver, {
              baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
                delegate,
              },
              runningMode: "IMAGE",
              minDetectionConfidence: 0.3,
            });
            console.log(`[Proctoring] MediaPipe FaceDetector loaded (${delegate})`);
            loaded = true;
            break;
          } catch (e) {
            console.warn(`[Proctoring] MediaPipe ${delegate} failed:`, e);
          }
        }
        if (!loaded) console.error("[Proctoring] MediaPipe FaceDetector unavailable");
      } catch (err) {
        console.warn("[Proctoring] MediaPipe FaceDetector failed:", err);
      }
    })();

    // Require CONSECUTIVE misses before alerting — single frame with bad lighting shouldn't count
    let consecutiveFaceMissing = 0;
    let consecutiveMultipleFaces = 0;

    const detect = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      let faceCount = -1;

      // Try MediaPipe first, then Chrome native
      if (mediaPipeDetectorRef.current) {
        try {
          const result = mediaPipeDetectorRef.current.detect(video);
          faceCount = result.detections.length;
        } catch {}
      } else if (nativeFaceDetectorRef.current) {
        try {
          const faces = await nativeFaceDetectorRef.current.detect(video);
          faceCount = faces.length;
        } catch {}
      }

      if (faceCount === -1 && !detectionFailedRef.current) {
        detectionFailedRef.current = true;
        console.error("[Proctoring] No face detector available — face detection disabled");
        sendProctoringEvent(interviewId, "detection_unavailable", "info", "Face detection unavailable on this browser", token);
      }

      if (faceCount === 0) {
        consecutiveFaceMissing++;
        consecutiveMultipleFaces = 0;
        // 12 consecutive misses at 1.5s interval = ~18s — handles bad lighting, sneezing, leaning
        if (consecutiveFaceMissing >= 12) {
          alert("face_missing", "flag", "We can't see you — please make sure your face is visible to the camera");
          consecutiveFaceMissing = 0;
        }
      } else if (faceCount > 1) {
        consecutiveMultipleFaces++;
        consecutiveFaceMissing = 0;
        console.log(`[Proctoring] ${faceCount} faces detected (consecutive: ${consecutiveMultipleFaces})`);
        // 2 consecutive detections at 1.5s interval = ~3s
        if (consecutiveMultipleFaces >= 2) {
          alert("multiple_faces", "flag", "Another person detected in the frame — please ensure you are alone during the interview");
          consecutiveMultipleFaces = 0;
        }
      } else {
        // Face detected normally — reset counters
        consecutiveFaceMissing = 0;
        consecutiveMultipleFaces = 0;
      }
      // eye_away detection removed from strike counting — still fires but weight=0
    };

    const interval = setInterval(detect, 1500); // 1.5s — fast multi-face detection (~3s alert)
    return () => {
      cancelled = true;
      clearInterval(interval);
      // Clean up MediaPipe GPU resources
      if (mediaPipeDetectorRef.current) {
        try { mediaPipeDetectorRef.current.close(); } catch {}
        mediaPipeDetectorRef.current = null;
      }
    };
  }, [enabled, videoRef, alert]);

  // Virtual camera detection
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === "videoinput");
        const virtualPatterns = /obs|virtual|manycam|camtwist|snap.?camera|xsplit|streamlabs|fake|droidcam/i;
        for (const device of videoInputs) {
          if (virtualPatterns.test(device.label)) {
            alert("virtual_camera", "flag", `Virtual camera detected: ${device.label}`);
            break;
          }
        }
        // Also check active video track settings
        const video = videoRef.current;
        if (video?.srcObject) {
          const track = (video.srcObject as MediaStream).getVideoTracks()[0];
          if (track) {
            const settings = track.getSettings();
            // Virtual cameras often report 0 for deviceId or unusual frameRate
            if (settings.frameRate && (settings.frameRate < 10 || settings.frameRate > 120)) {
              alert("virtual_camera", "flag", "Unusual camera frame rate detected");
            }
          }
        }
      } catch {}
    })();
  }, [enabled, videoRef, alert]);

  // Periodic photo capture — first at 30s, then every 2 min. WebP + binary upload for minimal size.
  useEffect(() => {
    if (!enabled) return;
    const capture = () => {
      const video = videoRef.current;
      const canvas = photoCanvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, 320, 240);
      photoCountRef.current++;
      const count = photoCountRef.current;
      // WebP binary upload — decent quality for review
      canvas.toBlob((blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append("interviewId", interviewId);
        formData.append("type", "photo_capture");
        formData.append("severity", "info");
        formData.append("message", `Photo #${count}`);
        formData.append("photo", blob, `photo_${count}.webp`);
        if (token) formData.append("token", token);
        fetch("/api/proctor-event", { method: "POST", body: formData }).catch(() => {});
      }, "image/webp", 0.5);
    };
    const first = setTimeout(capture, 30000);
    const interval = setInterval(capture, 120000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [enabled, videoRef, interviewId]);

  // Bright object detection (phone screen) — every 5s
  useEffect(() => {
    if (!enabled) return;
    let consecutiveSuspicious = 0;
    const analyze = () => {
      const video = videoRef.current;
      const canvas = phoneCanvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      canvas.width = 160;
      canvas.height = 120;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, 160, 120);
      const data = ctx.getImageData(0, 0, 160, 120).data;
      let bright = 0, total = 0;
      for (let y = 60; y < 120; y++) {
        for (let x = 0; x < 50; x++) {
          const idx = (y * 160 + x) * 4;
          if ((data[idx] + data[idx + 1] + data[idx + 2]) / 3 > 200) bright++;
          total++;
        }
        for (let x = 110; x < 160; x++) {
          const idx = (y * 160 + x) * 4;
          if ((data[idx] + data[idx + 1] + data[idx + 2]) / 3 > 200) bright++;
          total++;
        }
      }
      if (total > 0 && bright / total > 0.3) {
        consecutiveSuspicious++;
        if (consecutiveSuspicious >= 4) {
          alert("phone_detected", "flag", "Bright object detected — possible phone or secondary screen");
          consecutiveSuspicious = 0;
        }
      } else {
        consecutiveSuspicious = Math.max(0, consecutiveSuspicious - 1);
      }
    };
    const interval = setInterval(analyze, 5000);
    return () => clearInterval(interval);
  }, [enabled, videoRef, alert]);

  return null;
}
