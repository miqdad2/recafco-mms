import "server-only";

// CSRF guard for cookie-authenticated JSON/multipart route handlers — the
// same check Next.js applies to Server Actions: a browser request that
// carries an Origin header must come from this app's own host. Requests
// without an Origin header (same-origin GET, non-browser clients) pass;
// the session cookie is SameSite=Lax, so a cross-site POST carries no
// session anyway.
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host.split(",")[0]!.trim();
  } catch {
    return false;
  }
}
