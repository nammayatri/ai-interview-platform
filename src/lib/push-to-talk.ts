// Manual voice mode: the candidate taps a mic button (or presses Ctrl+M) to START speaking and taps
// again to STOP — what they said is then sent to the AI. Plain class (no React) so it can be tested.
//
//   idle ──start()──▶ listening ──stop()──▶ sending ──(grace ms)──▶ idle
//
// "sending" keeps accepting transcripts for a short grace period so words the speech recogniser is
// still finalising (it lags the audio by a few hundred ms) are not cut off.

export type TalkState = "idle" | "listening" | "sending";

export interface PushToTalkOptions {
  /** Called when the grace period ends — send everything collected so far. */
  onSubmit: () => void;
  /** Called on every state change (drives the UI). */
  onChange?: (state: TalkState) => void;
  /** Called when listening starts (e.g. to stop the AI's voice and clear stale text). */
  onStart?: () => void;
  /** How long to keep accepting transcripts after "stop". */
  graceMs?: number;
}

export class PushToTalk {
  private state: TalkState = "idle";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: PushToTalkOptions) {}

  getState(): TalkState { return this.state; }

  /** Should incoming transcripts be kept? True while listening or finishing up. */
  isAccepting(): boolean { return this.state !== "idle"; }

  private set(next: TalkState) {
    if (this.state === next) return;
    this.state = next;
    this.opts.onChange?.(next);
  }

  start(): boolean {
    if (this.state !== "idle") return false;
    this.opts.onStart?.();
    this.set("listening");
    return true;
  }

  stop(): boolean {
    if (this.state !== "listening") return false;
    this.set("sending");
    this.timer = setTimeout(() => {
      this.timer = null;
      this.opts.onSubmit();
      this.set("idle");
    }, this.opts.graceMs ?? 700);
    return true;
  }

  /** One control for the button and the shortcut: idle → start, listening → stop, sending → ignored. */
  toggle(): TalkState {
    if (this.state === "idle") this.start();
    else if (this.state === "listening") this.stop();
    return this.state;
  }

  /** Leave manual mode / unmount: drop everything without sending. */
  reset() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.set("idle");
  }
}

/** Ctrl+M (no Shift/Alt/Cmd), ignoring key auto-repeat. */
export function isTalkShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat?: boolean }): boolean {
  return e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && e.key.toLowerCase() === "m";
}
