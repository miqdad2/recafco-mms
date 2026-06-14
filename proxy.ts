/**
 * Next.js proxy file (replaces middleware.ts).
 *
 * Responsibilities:
 * 1. Auth session enforcement — redirects unauthenticated users to /login.
 * 2. IP-based rate limiting for login submissions (brute-force prevention).
 * 3. IP-based rate limiting for health-check endpoints (DoS prevention).
 *
 * The module-level Map persists across requests in a single Node.js process,
 * which is correct for local dev and single-instance private-cloud deployments.
 * For multi-instance: replace with a Redis-backed implementation.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/auth/middleware";

// ── Rate-limit store ──────────────────────────────────────────────────────────

type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

function consume(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || now >= bucket.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

// ── IP extraction ─────────────────────────────────────────────────────────────

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

// ── Config ────────────────────────────────────────────────────────────────────

// 30 login POST submissions per IP per 15 minutes.
const LOGIN_MAX = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// 120 health-check requests per IP per minute.
const HEALTH_MAX = 120;
const HEALTH_WINDOW_MS = 60 * 1000;

// ── Proxy ─────────────────────────────────────────────────────────────────────

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { method } = request;
  const ip = clientIp(request);

  // Rate-limit POST requests to /login.
  if (pathname === "/login" && method === "POST") {
    const allowed = consume(`rl:login:ip:${ip}`, LOGIN_MAX, LOGIN_WINDOW_MS);
    if (!allowed) {
      return new NextResponse(
        "Too many login attempts from this IP address. Please wait 15 minutes before trying again.",
        {
          status: 429,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Retry-After": "900"
          }
        }
      );
    }
  }

  // Rate-limit health-check endpoints.
  if (pathname.startsWith("/api/health")) {
    const allowed = consume(`rl:health:ip:${ip}`, HEALTH_MAX, HEALTH_WINDOW_MS);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many health-check requests. Please slow down." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
  }

  // Auth session enforcement.
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
