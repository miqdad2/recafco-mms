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

// Worker Timer and Closure Logic Hardening Unit 10G.53, Task 6/7 — production
// hydration-safety fix.
//
// The previous version computed its initial state as
// `useState(() => formatElapsed(Date.now() - new Date(startedAt).getTime()))`.
// That initializer runs during BOTH the server render (using the server's
// clock) and React's first client render before hydration commits (using the
// browser's clock) — two different instants, so the very first paint's text
// content almost never matches between server and client. On localhost this
// gap is a few milliseconds and self-corrects too fast to ever notice; on a
// real deployed server under real network latency (and with several rows
// hydrating on one Daily Activity page) the gap is large enough to be a
// genuine hydration mismatch, which is the most likely explanation for "the
// live counter sometimes does not update after deployment" — a component
// that failed to hydrate cleanly can end up with its effects never
// attaching, leaving the displayed number frozen at whatever the server
// rendered until a full reload.
//
// Fixed with the exact same pattern this codebase already established for
// this exact class of bug (components/layout/live-top-clock.tsx): start from
// a fixed, time-independent placeholder ("00:00") that renders identically
// on the server and on the client's pre-hydration pass — never computed from
// `Date.now()` — then only ever set a real, clock-derived value from inside
// useEffect, a post-hydration DOM update, never a mismatch. That first real
// tick fires synchronously on mount (before the 1s interval's first delay),
// so the placeholder is on screen for at most one paint. The elapsed time
// itself is still always recomputed from `startedAt` (the DB's own
// started_at, round-tripped as a full ISO-8601 UTC string) plus the
// browser's current clock on every tick, exactly as before — correct after
// a hard refresh, and correct from any other browser, since neither depends
// on anything but that one persisted timestamp.
const PLACEHOLDER = "00:00";

export function LiveTimer({ startedAt, className }: { startedAt: string; className?: string }) {
  const [elapsedLabel, setElapsedLabel] = useState<string | null>(null);

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
      {elapsedLabel ?? PLACEHOLDER}
    </span>
  );
}
