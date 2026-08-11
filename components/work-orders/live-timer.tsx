"use client";

import { useEffect, useState } from "react";

// Premium Job Card Detail Page Redesign Unit 8C.2, Task 7: a purely
// visual, client-side ticking display for an Active work session — recomputed
// every second from `startedAt` (already-fetched, unchanged data). Never
// used for duration_minutes/calculated_amount, which stay exactly the
// server-computed values they always were (lib/backend/work-orders/work-sessions.ts,
// untouched by this unit).
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function LiveTimer({ startedAt, className }: { startedAt: string; className?: string }) {
  const [elapsedLabel, setElapsedLabel] = useState(() => formatElapsed(Date.now() - new Date(startedAt).getTime()));

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsedLabel(formatElapsed(Date.now() - start));
    tick();
    const interval = setInterval(tick, 1000);
    // Daily Activity Timer Reliability Unit 10G.24, Task 2/3: browsers
    // throttle (or fully suspend) setInterval timers in hidden/inactive
    // tabs, which can leave an Active worker's displayed elapsed time
    // looking frozen even though nothing is wrong server-side and no data
    // was lost — the true elapsed time is always re-derivable from
    // `startedAt` (unchanged) plus the browser's own current clock. Forcing
    // an immediate re-tick the moment the tab regains visibility (instead
    // of waiting for the next scheduled 1s tick, itself possibly delayed)
    // guarantees the display is never stale for more than an instant. Pure
    // client-side display recompute from data already held — no new
    // request, poll, or connection.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") tick();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [startedAt]);

  return (
    <span className={className ?? "font-mono text-sm font-black tabular-nums text-[#16A34A]"} aria-live="off">
      {elapsedLabel}
    </span>
  );
}
