// Captures the microphone as raw 16 kHz mono PCM16 (what Voxtral/vLLM expects), instead of the
// WebM/Opus that MediaRecorder produces for Deepgram. Resampling happens in the audio worklet so it
// works at any native sample rate (Firefox can't force a 16 kHz AudioContext on a live stream).

export const PCM_TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100 ms per message

// Runs inside the AudioWorklet global scope (`sampleRate`, `AudioWorkletProcessor`, `registerProcessor`).
export const PCM_WORKLET_SOURCE = `
class Pcm16kProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${PCM_TARGET_RATE};
    this.acc = 0; this.sum = 0; this.n = 0; this.out = [];
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.n++; this.acc += 1;
      if (this.acc >= this.ratio) {            // box-filter average = cheap low-pass + decimate
        this.acc -= this.ratio;
        this.out.push(this.sum / this.n);
        this.sum = 0; this.n = 0;
      }
    }
    while (this.out.length >= ${CHUNK_SAMPLES}) {
      const slice = this.out.splice(0, ${CHUNK_SAMPLES});
      const pcm = new Int16Array(${CHUNK_SAMPLES});
      for (let i = 0; i < ${CHUNK_SAMPLES}; i++) {
        const s = Math.max(-1, Math.min(1, slice[i]));
        pcm[i] = s < 0 ? s * 32768 : s * 32767;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm16k", Pcm16kProcessor);
`;

export interface PcmCapture { stop: () => void }

/** Start streaming PCM16 chunks of `stream` to `onChunk`. Throws if AudioWorklet is unavailable. */
export async function startPcmCapture(stream: MediaStream, onChunk: (pcm: ArrayBuffer) => void): Promise<PcmCapture> {
  const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx || !("audioWorklet" in Ctx.prototype)) throw new Error("AudioWorklet not supported in this browser");

  const ctx = new Ctx();
  const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm16k");
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
  // Must be connected to the graph for process() to run; a zero-gain sink avoids playing the mic back.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  return {
    stop: () => {
      try { node.port.onmessage = null; } catch {}
      try { source.disconnect(); } catch {}
      try { node.disconnect(); } catch {}
      try { mute.disconnect(); } catch {}
      try { ctx.close(); } catch {}
    },
  };
}
