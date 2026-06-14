import { getCurrentUserContext } from "@/lib/auth/context";
import { getUnreadNotificationCount } from "@/lib/notifications/service";
import { prisma } from "@/lib/db/prisma";

// Use the Node.js runtime so Prisma (TCP to PostgreSQL) works inside the handler.
export const runtime = "nodejs";
// Never cache — every request opens a fresh SSE stream.
export const dynamic = "force-dynamic";

// DB poll interval per open connection.
// 15 s keeps the badge feeling live without high query volume.
// At 50 concurrent users: ≈ 6 queries/15 s ≈ negligible for PostgreSQL.
const SSE_POLL_MS = 15_000;

// Heartbeat interval. Keeps the TCP connection alive through load-balancers
// and nginx proxies that would otherwise kill idle connections.
const SSE_PING_MS = 25_000;

/**
 * Lightweight query for notifications created after `since`.
 * Returns at most 10 rows (newest first) so the payload stays small.
 * Any DB error returns an empty array — the stream keeps running.
 */
async function getNewNotificationsSince(userId: string, since: Date) {
  try {
    return await prisma.notifications.findMany({
      where: {
        OR: [{ recipient_user_id: userId }, { recipient_id: userId }],
        archived_at: null,
        created_at: { gt: since },
      },
      orderBy: { created_at: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        category: true,
        priority: true,
        created_at: true,
      },
    });
  } catch {
    return [];
  }
}

/**
 * GET /api/notifications/stream
 *
 * Server-Sent Events stream for the authenticated user.
 *
 * Events emitted:
 *   unread_count  { count: number }
 *     Sent immediately on connect and after every DB poll.
 *
 *   notification  { id, title, category, priority, created_at }
 *     Sent for each notification created since the previous poll.
 *     The client should use this as a refresh trigger — it does NOT
 *     carry the full notification payload.
 *
 *   ping  { ts: number }
 *     Heartbeat every 25 s to keep the connection alive.
 *
 * Security:
 *   - Returns 401 for unauthenticated requests.
 *   - Queries are scoped to the authenticated user's profile ID.
 *   - No other user's data is ever included in the stream.
 *
 * Cleanup:
 *   - Closes timers when the client disconnects (request.signal abort).
 *   - Also cleaned up via ReadableStream.cancel() for double coverage.
 */
export async function GET(request: Request): Promise<Response> {
  const context = await getCurrentUserContext();
  if (!context) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = context.userId;
  const encoder = new TextEncoder();

  // Shared mutable state for the lifetime of this SSE connection.
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  // Track when we last polled so we only send truly new notifications.
  let lastCheckedAt = new Date();

  function cleanup() {
    if (closed) return;
    closed = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (pingTimer) {
      clearTimeout(pingTimer);
      pingTimer = null;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(eventName: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller.enqueue throws when the stream is already closed
          doClose();
        }
      }

      function doClose() {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed — ignore
        }
      }

      function schedulePing() {
        if (closed) return;
        pingTimer = setTimeout(() => {
          send("ping", { ts: Date.now() });
          schedulePing();
        }, SSE_PING_MS);
      }

      function schedulePoll() {
        if (closed) return;
        pollTimer = setTimeout(async () => {
          if (closed) return;
          try {
            // Capture the window before awaiting so no notifications slip through.
            const since = lastCheckedAt;
            lastCheckedAt = new Date();

            const [rows, count] = await Promise.all([
              getNewNotificationsSince(userId, since),
              getUnreadNotificationCount(userId),
            ]);

            send("unread_count", { count });

            // Send a lightweight event per new notification — client uses these
            // as refresh triggers, not as full notification payloads.
            for (const row of rows) {
              send("notification", {
                id: row.id,
                title: row.title,
                category: row.category,
                priority: row.priority,
                created_at: row.created_at.toISOString(),
              });
            }
          } catch {
            // DB error — skip this tick, reschedule next normally
          }

          schedulePoll();
        }, SSE_POLL_MS);
      }

      // Primary cleanup path: fires when the HTTP client closes the connection.
      request.signal.addEventListener("abort", doClose);

      // Send the initial unread count as soon as the stream opens.
      // This gives the badge an accurate count before the first poll fires.
      void (async () => {
        try {
          const count = await getUnreadNotificationCount(userId);
          send("unread_count", { count });
        } catch {
          // Ignore — the first poll (15 s) will send the count
        }
      })();

      schedulePing();
      schedulePoll();
    },

    // Secondary cleanup path: fires when the Response body is cancelled
    // (e.g., by the HTTP layer before abort fires).
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      // Prevent nginx/Cloudflare from buffering events — they must arrive immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
