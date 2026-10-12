import { createRequire } from "module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeJobCount, beginJob, trackJob } from "../active-jobs";

const createGracefulShutdown = createRequire(import.meta.url)("../../../graceful-shutdown.js");

function harness(over: Record<string, unknown> = {}) {
  let jobs = 0;
  let open = 0;
  const calls: string[] = [];
  const exit = vi.fn();
  const server = {
    close: vi.fn(() => calls.push("server.close")),
    closeIdleConnections: vi.fn(),
    getConnections: (cb: (e: Error | null, n: number) => void) => cb(null, open),
  };
  const wss = { clients: [{ close: vi.fn() }], close: vi.fn() };
  const pool = { end: vi.fn(() => { calls.push("pool.end"); return Promise.resolve(); }) };
  const shutdown = createGracefulShutdown({ server, wss, pool, getActiveJobs: () => jobs, exit, log: () => {}, drainMs: 60000, settleMs: 5000, pollMs: 1000, ...over });
  return { shutdown, exit, server, wss, pool, calls, setJobs: (n: number) => (jobs = n), setOpen: (n: number) => (open = n) };
}
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

describe("graceful shutdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("closes the WebSocket clients right away, but keeps serving during the settle period", async () => {
    const h = harness();
    h.shutdown();
    expect(h.wss.clients[0].close).toHaveBeenCalledWith(1001);
    expect(h.server.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.server.close).toHaveBeenCalledTimes(1);
  });

  it("exits promptly when nothing is running", async () => {
    const h = harness();
    h.shutdown();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("waits for a running scoring job, and closes the database pool only after it finishes", async () => {
    const h = harness();
    h.setJobs(1);
    h.shutdown();
    await vi.advanceTimersByTimeAsync(5000 + 30000);
    expect(h.exit).not.toHaveBeenCalled();
    expect(h.pool.end).not.toHaveBeenCalled();
    h.setJobs(0);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(h.pool.end).toHaveBeenCalled();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("waits for open requests (a streaming AI reply) too", async () => {
    const h = harness();
    h.setOpen(2);
    h.shutdown();
    await vi.advanceTimersByTimeAsync(5000 + 10000);
    expect(h.exit).not.toHaveBeenCalled();
    h.setOpen(0);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("gives up at the drain deadline and exits with an error if a job was still running", async () => {
    const h = harness({ drainMs: 20000 });
    h.setJobs(1);
    h.shutdown();
    await vi.advanceTimersByTimeAsync(40000);
    await flush();
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("ignores a second signal", async () => {
    const h = harness();
    h.shutdown();
    h.shutdown();
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(h.server.close).toHaveBeenCalledTimes(1);
  });
});

describe("active job counter", () => {
  it("counts work in progress and never goes negative", async () => {
    expect(activeJobCount()).toBe(0);
    const end = beginJob();
    expect(activeJobCount()).toBe(1);
    end();
    end(); // calling twice is harmless
    expect(activeJobCount()).toBe(0);
  });
  it("trackJob counts for the duration, even when the work throws", async () => {
    let during = -1;
    await expect(trackJob(async () => { during = activeJobCount(); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(during).toBe(1);
    expect(activeJobCount()).toBe(0);
  });
});
