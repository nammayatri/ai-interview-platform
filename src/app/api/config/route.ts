import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Runtime config served to the client — avoids NEXT_PUBLIC_* build-time baking.
// Change these env vars at runtime (configmap/secret) without rebuilding.
export async function GET() {
  return NextResponse.json({
    // Proctoring
    maxProctoringStrikes: parseInt(process.env.MAX_PROCTORING_STRIKES || process.env.NEXT_PUBLIC_MAX_PROCTORING_STRIKES || "25"),

    // STT
    sttProviders: (process.env.STT_CLIENT_PROVIDERS || "deepgram,browser").split(",").map(s => s.trim()),
    sttBackend: process.env.STT_PROVIDER || "deepgram",
    // What the browser must send: raw 16 kHz PCM for Voxtral, a WebM/Opus stream for everything else
    sttAudio: (process.env.STT_PROVIDER || "deepgram") === "voxtral" ? "pcm16" : "webm",
    silenceDelayMs: parseInt(process.env.SILENCE_DELAY_MS || "6000"),
    // Voice mode. AUTO_VOICE_ENABLED=false removes the Auto option, so every interview is manual (Ctrl+M to speak, Ctrl+M to send).
    // DEFAULT_VOICE_MODE (manual | auto) is what a candidate starts on. The puzzle round is always manual.
    autoVoiceEnabled: (process.env.AUTO_VOICE_ENABLED || "true").toLowerCase() !== "false",
    defaultVoiceMode: (process.env.DEFAULT_VOICE_MODE || "manual").toLowerCase() === "auto" ? "auto" : "manual",

    // App
    appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "",
    environment: process.env.NODE_ENV || "development",
  });
}
