"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isSafeToRefresh } from "@/lib/realtime/refresh-guards";

interface UseRealtimeEventsOptions {
  /**
   * Event-type prefixes this page cares about, e.g. ["job_card.", "work_order.",
   * "materials_request."]. Matched with String#startsWith against the
   * event_type on each incoming realtime event — an event whose type doesn't
   * match any prefix is ignored entirely (no refresh, no debounce timer).
   */
  watch: string[];
  /** Debounce window — many events in quick succession collapse into one refresh. */
  debounceMs?: number;
  enabled?: boolean;
}

type RealtimeStreamEvent = { event_type: string; entity_type: string; entity_id: string | null };

/**
 * Opens an EventSource to the existing /api/notifications/stream endpoint
 * (the same one the notification bell already uses) and listens for the
 * "realtime" event — a lightweight { event_type, entity_type, entity_id }
 * signal with no sensitive payload. On a match against `watch`, debounces
 * and calls router.refresh().
 *
 * This intentionally does NOT own a dedicated SSE connection per page: it
 * opens its own EventSource (closed on unmount/navigation), same as the
 * notification badge's own connection — at most 2 concurrent SSE
 * connections per tab (this + the persistent notification badge), not one
 * per component.
 *
 * Falls back gracefully: EventSource auto-reconnects on transient errors,
 * and every page that uses this hook also keeps its existing AutoRefresh
 * poll running independently, so a prolonged SSE outage still catches up
 * within that poll's interval.
 */
export function useRealtimeEvents({ watch, debounceMs = 1500, enabled = true }: UseRealtimeEventsOptions) {
  const router = useRouter();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefresh = useRef(false);
  // Stable across renders without forcing callers to memoize the array themselves.
  const watchKey = watch.join(",");

  useEffect(() => {
    if (!enabled || watch.length === 0) return;

    const es = new EventSource("/api/notifications/stream");

    function scheduleRefresh() {
      if (debounceTimer.current) return; // already scheduled — this event just needed to arrive, not add another timer
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        if (isSafeToRefresh()) {
          pendingRefresh.current = false;
          router.refresh();
        } else {
          // User is typing/modal open/tab hidden — try again shortly rather
          // than dropping the refresh entirely.
          pendingRefresh.current = true;
        }
      }, debounceMs);
    }

    function onRealtime(event: MessageEvent<string>) {
      try {
        const data = JSON.parse(event.data) as RealtimeStreamEvent;
        if (watch.some((prefix) => data.event_type.startsWith(prefix))) {
          scheduleRefresh();
        }
      } catch {
        // Ignore malformed events
      }
    }

    es.addEventListener("realtime", onRealtime as EventListener);
    // EventSource auto-reconnects on error — matches the existing
    // notification badge connection's own convention; do not close on error.

    function onVisible() {
      if (document.visibilityState === "visible" && pendingRefresh.current && isSafeToRefresh()) {
        pendingRefresh.current = false;
        router.refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      es.removeEventListener("realtime", onRealtime as EventListener);
      document.removeEventListener("visibilitychange", onVisible);
      es.close();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, debounceMs, enabled, router]);
}
