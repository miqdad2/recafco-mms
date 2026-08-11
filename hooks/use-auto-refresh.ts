"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { isSafeToRefresh } from "@/lib/realtime/refresh-guards";

interface UseAutoRefreshOptions {
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * Polls router.refresh() on a timer so server-rendered pages pick up backend
 * changes (new repair orders, status updates, parts request changes) without
 * the user manually reloading.
 *
 * Pauses while:
 *   - the tab is hidden (document.visibilityState === "hidden")
 *   - an input, textarea, or select is focused (user is typing in a form)
 *   - a modal/panel (role="dialog") is open
 *
 * Resumes and fires an immediate refresh when the tab becomes visible again.
 * Cleans up on unmount.
 */
export function useAutoRefresh({
  intervalMs = 30_000,
  enabled = true,
}: UseAutoRefreshOptions = {}) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function tryRefresh() {
      if (!isSafeToRefresh()) return;
      router.refresh();
    }

    function startTimer() {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(tryRefresh, intervalMs);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        tryRefresh();
        startTimer();
      } else {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }

    startTimer();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs, router]);
}
