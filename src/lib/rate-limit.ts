const requests = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60000) return;
  lastCleanup = now;
  requests.forEach((entry, key) => {
    if (now > entry.resetAt) {
      requests.delete(key);
    }
  });
}

export function rateLimit(ip: string, limit = 30, windowMs = 60000): boolean {
  const now = Date.now();
  cleanup();

  const entry = requests.get(ip);

  if (!entry || now > entry.resetAt) {
    requests.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Limit for the AI reply routes. A whole class or college often sits behind one public IP, so the IP limit is only a
 * wide safety net; the real limit is per interview (a candidate who retries or nudges a few times is still well under it).
 */
export function aiTurnAllowed(ip: string, interviewId: unknown): boolean {
  if (!rateLimit(`ai-ip:${ip}`, 1200, 60_000)) return false;
  return rateLimit(`ai-interview:${String(interviewId ?? "")}`, 40, 60_000);
}
