// Collects the candidate's finalized speech and decides when their "turn" is over.
// Plain class (no React) so the timing rules can be unit-tested.

export interface TurnBufferOptions {
  /** Silence (ms) after the last speech before the turn is sent automatically. */
  getDelayMs: () => number;
  /** Manual mode: never auto-send — the candidate taps "Done". */
  isManual: () => boolean;
  /** False while stopped / ending — nothing is sent. */
  canFlush: () => boolean;
  /** Called with the full text of a finished turn. */
  onFlush: (text: string) => void;
}

export class TurnBuffer {
  private buffer = "";
  private lastInterim = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suppressFinalsUntil = 0;

  constructor(private opts: TurnBufferOptions) {}

  private clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private schedule() {
    this.clearTimer();
    if (this.opts.isManual()) return;
    this.timer = setTimeout(() => this.flush(), this.opts.getDelayMs());
  }

  private flush() {
    this.timer = null;
    if (!this.opts.canFlush()) return;
    const full = this.buffer.trim();
    if (!full) return;
    this.buffer = "";
    this.opts.onFlush(full);
  }

  /** A finalized chunk of speech arrived. */
  addFinal(text: string) {
    if (!text.trim()) return;
    if (Date.now() < this.suppressFinalsUntil) return; // late duplicate of text just submitted via Done
    this.buffer += (this.buffer ? " " : "") + text;
    this.schedule();
  }

  /** Remember the latest in-progress (interim) text so "Done" can include it. */
  setInterim(text: string) {
    this.lastInterim = text;
  }

  /** The candidate is still speaking (interim result): push the silence deadline back. */
  interimActivity() {
    if (this.buffer.trim()) this.schedule();
    else this.clearTimer();
  }

  /** STT says the utterance ended: give the candidate the full silence window to continue. */
  utteranceEnd() {
    if (this.buffer.trim()) this.schedule();
  }

  /**
   * Send everything said so far right now (the "Done" button), including interim text that has
   * not been finalized yet. Returns true if pending interim text was merged (UI should clear it).
   */
  submitNow(): boolean {
    this.clearTimer();
    const pending = this.lastInterim.trim();
    let mergedInterim = false;
    if (pending) {
      this.buffer += (this.buffer ? " " : "") + pending;
      this.lastInterim = "";
      mergedInterim = true;
      this.suppressFinalsUntil = Date.now() + 1500; // STT may still finalize that same text
    }
    this.flush();
    return mergedInterim;
  }

  hasPending(): boolean {
    return !!(this.buffer.trim() || this.lastInterim.trim());
  }

  /** Drop everything (start / stop of the STT session). */
  clear() {
    this.buffer = "";
    this.lastInterim = "";
    this.clearTimer();
  }
}
