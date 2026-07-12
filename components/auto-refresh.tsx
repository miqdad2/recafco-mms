"use client";

import { useAutoRefresh } from "@/hooks/use-auto-refresh";

interface AutoRefreshProps {
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * Drop this into any server-rendered page to make it poll router.refresh()
 * on a timer. Renders nothing — pure behavior.
 *
 * Do NOT add to pages with unsaved form state (wizards, new-item forms).
 */
export function AutoRefresh({ intervalMs = 30_000, enabled = true }: AutoRefreshProps) {
  useAutoRefresh({ intervalMs, enabled });
  return null;
}
