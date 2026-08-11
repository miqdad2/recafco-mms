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
    <div
      className={`flex shrink-0 items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm sm:gap-2.5 sm:px-4 sm:py-2.5 ${className}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-[#ED1C24] sm:h-9 sm:w-9">
        <ClockIcon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="leading-tight">
        <p className="font-mono text-sm font-black tabular-nums text-[#111827] sm:text-base">
          {clock ? clock.time : "--:--:--"}
        </p>
        {/* Task 6 — mobile keeps only the time; the date is a nice-to-have
            that has no room to sit next to the role badge/bell/user/logout
            controls at narrow widths. */}
        <p className="hidden text-[10px] font-medium text-[#6B7280] sm:block">
          {clock ? clock.date : " "}
        </p>
      </div>
    </div>
  );
}
