"use client";

import { useRealtimeEvents } from "@/hooks/use-realtime-events";

interface RealtimeRefreshProps {
  /** Event-type prefixes this page should refresh on, e.g. ["job_card.", "materials_request."]. */
  watch: string[];
  debounceMs?: number;
  enabled?: boolean;
}

/**
 * Enterprise Real-Time Update Foundation Unit Task 5/6.
 *
 * Drop this into a server-rendered page (same pattern as <AutoRefresh />) to
 * make it refresh immediately when a relevant realtime event arrives,
 * instead of waiting for the next AutoRefresh poll tick. Renders nothing —
 * pure behavior. Keep the page's existing <AutoRefresh /> in place too — this
 * is a faster trigger on top of that poll, not a replacement for it.
 */
export function RealtimeRefresh({ watch, debounceMs, enabled = true }: RealtimeRefreshProps) {
  useRealtimeEvents({ watch, debounceMs, enabled });
  return null;
}
