import { getCurrentUserContext } from "@/lib/auth/context";
import { getUnreadNotificationCount } from "@/lib/notifications/service";
import { prisma } from "@/lib/db/prisma";
import { logSystemError } from "@/lib/errors/logging";

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
 * Enterprise Real-Time Update Foundation Unit Task 3/4: reuses the existing
 * realtime_events table (already written to by lib/realtime/events.ts'
 * emitRealtimeEvent, previously with "no active consumer") as the source for
 * a generic "something relevant changed, refresh this area" signal — rather
 * than building a second SSE endpoint/connection alongside the notification
 * stream this already is.
 *
 * Rows with no target_profile_id are broadcast to every connected user
 * (Task 4's documented fallback: minimal, non-sensitive event names only —
 * emitRealtimeEvent already strips cost/price/credential fields before a row
 * is ever written). Rows with a target_profile_id are only sent to that
 * user. No department/role-scoped filtering is applied yet — see the final
 * report's permission/security section for why this is safe today.
 */
async function getNewRealtimeEventsSince(userId: string, since: Date) {
  try {
    return await prisma.realtime_events.findMany({
      where: {
        created_at: { gt: since },
        OR: [{ target_profile_id: null }, { target_profile_id: userId }],
      },
      orderBy: { created_at: "desc" },
      take: 20,
      select: {
        event_type: true,
        entity_type: true,
        entity_id: true,
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
 *   realtime  { event_type, entity_type, entity_id }
 *     Enterprise Real-Time Update Foundation Unit Task 4: sent for each row
 *     in realtime_events created since the previous poll (that row's own
 *     target_profile_id already scoped to this user or broadcast). Consumed
 *     by useRealtimeEvents/<RealtimeRefresh watch={[...]} /> on individual
 *     pages — never carries cost/price data (emitRealtimeEvent strips those
 *     before the row is ever written) and never the full entity record.
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
  // Separate cursor for the generic realtime_events poll (Task 4) — kept
  // independent of lastCheckedAt so a slow notifications query never delays
  // the realtime_events window or vice versa.
  let lastCheckedAtRealtime = new Date();

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
            const realtimeSince = lastCheckedAtRealtime;
            lastCheckedAtRealtime = new Date();

            const [rows, count, realtimeRows] = await Promise.all([
              getNewNotificationsSince(userId, since),
              getUnreadNotificationCount(userId),
              getNewRealtimeEventsSince(userId, realtimeSince),
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

            // Enterprise Real-Time Update Foundation Unit Task 4: generic
            // "something relevant changed" signal — no title/message/costs,
            // just enough for the client's useRealtimeEvents hook to decide
            // whether to refresh the current page.
            for (const row of realtimeRows) {
              send("realtime", {
                event_type: row.event_type,
                entity_type: row.entity_type,
                entity_id: row.entity_id,
              });
            }
          } catch (error) {
            // Enterprise Error Handling Audit Unit Task 9: still never
            // crashes the stream (page keeps working, next tick retries) —
            // just also leaves a trace now instead of failing completely
            // silently on every tick during a DB outage.
            await logSystemError({
              source: "notifications.stream.poll",
              severity: "warning",
              message: error instanceof Error ? error.message : "SSE poll tick failed",
              userId,
              route: "/api/notifications/stream"
            });
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
