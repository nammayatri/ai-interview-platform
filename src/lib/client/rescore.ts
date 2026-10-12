// Scoring a long interview with a reasoning model takes minutes, so the server runs it in the background.
// This starts it and polls until it is done, so the buttons can keep their simple "if (res.ok)" flow.
export async function rescoreAndWait(interviewId: string, maxWaitMs = 22 * 60 * 1000): Promise<{ ok: boolean; status: number }> {
  const res = await fetch("/api/scorecard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interviewId }),
  });
  if (res.status !== 202) return { ok: res.ok, status: res.status };

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const s = await (await fetch(`/api/scoring-status/${interviewId}`)).json();
      if (s.status === "completed") return { ok: true, status: 200 };
      if (s.status === "failed") return { ok: false, status: 500 };
    } catch {
      /* keep polling */
    }
  }
  return { ok: false, status: 504 };
}
