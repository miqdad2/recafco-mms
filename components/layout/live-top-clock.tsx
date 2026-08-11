"use client";

import { useEffect, useState } from "react";
import { Clock as ClockIcon } from "lucide-react";

// Top Navbar Clock Placement Unit 10G.20D, Task 1/2: the live clock
// previously lived inside the dashboard-only greeting header
// (components/dashboard/live-dashboard-header.tsx), so it only appeared on
// /dashboard and disappeared as soon as the greeting's own top strip scrolled
// out of the initial viewport. Extracted here as its own small, reusable,
// client-only widget so it can render once in the shared app top bar
// (components/layout/app-layout.tsx) and be visible on every authenticated
// page (Task 8), not just the dashboard.
//
// Hydration safety: same pattern as the greeting header this was split out
// of — `now` starts `null`, so the very first server-rendered/pre-hydration
// paint always shows the same time-independent "--:--:--" fallback (never a
// value derived from the visitor's local clock, which the server can't
// know). Only after mount does the tick interval start setting real values,
// which is a post-hydration DOM update, not a mismatch.
//
// Dashboard Header Clock Refinement Unit 10G.30: dropped the
// rounded/bordered/shadowed "card" chrome (border, bg-white pill, shadow-sm,
// colored icon badge) that made this read as a separate floating widget
// competing with the top strip around it. It now renders as plain text
// embedded directly in the shared header strip -- bigger, bolder time,
// smaller secondary date, and a small unboxed icon -- with no new state, no
// new timer, no logic change at all (still the same one-per-second
// setInterval tick).

function formatClock(now: Date): { time: string; date: string } {
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return { time, date };
}

export function LiveTopClock({ className = "" }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const clock = now ? formatClock(now) : null;

  return (
    <div className={`flex shrink-0 items-center gap-1.5 sm:gap-2 ${className}`}>
      <ClockIcon className="h-4 w-4 shrink-0 text-[#ED1C24]/70 sm:h-5 sm:w-5" aria-hidden="true" />
      <div className="leading-none">
        <p className="font-mono text-lg font-black tracking-wide tabular-nums text-[#111827] sm:text-2xl">
          {clock ? clock.time : "--:--:--"}
        </p>
        {/* Task 6 -- mobile keeps only the time; the date is a nice-to-have
            that has no room to sit next to the role badge/bell/user/logout
            controls at narrow widths. */}
        <p className="mt-0.5 hidden text-xs font-medium text-[#6B7280] sm:block">
          {clock ? clock.date : " "}
        </p>
      </div>
    </div>
  );
}
