// Exponential backoff with jitter.
//
// Backoff: wait longer after each failure, doubling, up to a ceiling, so a
// struggling server is not hammered by the client that just failed.
//
// Jitter: a random factor on every delay so that fifty devices that lost
// signal together do not retry together. Without it the retries arrive as
// one synchronised spike.

export interface BackoffOptions {
  /** First delay in ms. */
  baseMs?: number;
  /** Longest delay in ms. */
  capMs?: number;
  /** Injectable for tests. Returns [0, 1). */
  random?: () => number;
}

/**
 * Delay before attempt number `attempt` (0-based), in ms. The result lands
 * somewhere in [0.5x, 1x] of the capped exponential, so retries spread out.
 */
export function nextDelayMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 1000;
  const cap = opts.capMs ?? 60_000;
  const random = opts.random ?? Math.random;
  const exponential = Math.min(base * 2 ** Math.max(0, attempt), cap);
  const jitter = 0.5 + random() * 0.5;
  return Math.round(exponential * jitter);
}
