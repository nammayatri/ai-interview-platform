// Counts background work running inside this pod (scoring), so a shutdown can wait for it instead of killing it.
// Kept on globalThis because the Next.js bundle and server-custom.js are separate modules in one process.
const g = globalThis as unknown as { __activeJobs?: number };

export const activeJobCount = (): number => g.__activeJobs || 0;

/** Marks one unit of background work as running; call the returned function when it is finished. */
export function beginJob(): () => void {
  g.__activeJobs = activeJobCount() + 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    g.__activeJobs = Math.max(0, activeJobCount() - 1);
  };
}

export async function trackJob<T>(fn: () => Promise<T>): Promise<T> {
  const end = beginJob();
  try {
    return await fn();
  } finally {
    end();
  }
}
