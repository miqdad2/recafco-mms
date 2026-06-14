/**
 * In-memory rate limiter for single-instance Node.js deployments.
 *
 * Works correctly for local development and private-cloud single-server setups.
 * For multi-instance deployments, replace the Map with a shared Redis-backed store.
 *
 * Design: fixed window (resets at `resetAt`), counted per key.
 * Memory: buckets are pruned every 10 minutes; old entries are deleted on access.
 */

type Bucket = {
  count: number;
  resetAt: number; // Unix ms
};

const buckets = new Map<string, Bucket>();

// Prune expired buckets every 10 minutes so the Map doesn't grow unbounded.
// unref() prevents this timer from keeping the Node.js process alive.
const pruner = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}, 10 * 60 * 1000);

if (typeof pruner === "object" && pruner !== null && "unref" in pruner) {
  (pruner as NodeJS.Timeout).unref();
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Check and record a rate-limited event.
 *
 * @param key          Unique bucket key (e.g. "login:email:user@example.com")
 * @param maxRequests  Maximum allowed requests within the window
 * @param windowMs     Window duration in milliseconds
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  existing.count += 1;
  return { allowed: true };
}

// ── Login-specific helpers ────────────────────────────────────────────────────

const LOGIN_EMAIL_MAX = 10;          // 10 attempts per email per window
const LOGIN_EMAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Per-email rate limit for the login action.
 * Prevents targeted brute-force attacks against a known email address.
 * IP-level rate limiting is handled separately in middleware.ts.
 */
export function checkLoginEmailRateLimit(email: string): RateLimitResult {
  return checkRateLimit(`login:email:${email.toLowerCase()}`, LOGIN_EMAIL_MAX, LOGIN_EMAIL_WINDOW_MS);
}

/**
 * Reset the email rate-limit bucket after a successful login.
 * This avoids penalising users who had previous failures but then recovered.
 */
export function resetLoginEmailRateLimit(email: string): void {
  buckets.delete(`login:email:${email.toLowerCase()}`);
}
