"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

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

    function isUserTyping(): boolean {
      const active = document.activeElement;
      if (!active || active === document.body) return false;
      const tag = active.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (active instanceof HTMLElement && active.isContentEditable) return true;
      return false;
    }

    function tryRefresh() {
      if (document.visibilityState === "hidden") return;
      if (isUserTyping()) return;
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
