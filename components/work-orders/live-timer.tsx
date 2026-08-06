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
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <span className={className ?? "font-mono text-sm font-black tabular-nums text-[#16A34A]"} aria-live="off">
      {elapsedLabel}
    </span>
  );
}
