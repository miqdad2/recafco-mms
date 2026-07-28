"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isSafeToRefresh } from "@/lib/realtime/refresh-guards";
import { useRealtimeConnection } from "@/components/realtime/realtime-connection-provider";

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
 * Listens for the "realtime" event — a lightweight
 * { event_type, entity_type, entity_id } signal with no sensitive payload —
 * via the shared RealtimeConnectionProvider (SSE Connection Consolidation
 * Unit: one EventSource per tab, shared with the notification badge and
 * corner toast, rather than this hook opening its own). On a match against
 * `watch`, debounces and calls router.refresh().
 *
 * Falls back gracefully: the shared connection's EventSource auto-reconnects
 * on transient errors, and every page that uses this hook also keeps its
 * existing AutoRefresh poll running independently, so a prolonged SSE outage
 * still catches up within that poll's interval.
 */
export function useRealtimeEvents({ watch, debounceMs = 1500, enabled = true }: UseRealtimeEventsOptions) {
  const router = useRouter();
  const { subscribe } = useRealtimeConnection();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefresh = useRef(false);
  // Stable across renders without forcing callers to memoize the array themselves.
  const watchKey = watch.join(",");

  useEffect(() => {
    if (!enabled || watch.length === 0) return;

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

    function onRealtime(data: RealtimeStreamEvent) {
      if (watch.some((prefix) => data.event_type.startsWith(prefix))) {
        scheduleRefresh();
      }
    }

    const unsubscribe = subscribe<RealtimeStreamEvent>("realtime", onRealtime);

    function onVisible() {
      if (document.visibilityState === "visible" && pendingRefresh.current && isSafeToRefresh()) {
        pendingRefresh.current = false;
        router.refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, debounceMs, enabled, router, subscribe]);
}
