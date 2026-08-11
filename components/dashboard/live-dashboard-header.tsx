"use client";

import { useEffect, useRef, useState } from "react";

// Dashboard Greeting and Live Clock UI Polish Unit 10G.18.
//
// Replaces the dashboard's static "Hello, {name}" header with a time-of-day
// greeting ("Good morning/afternoon/evening") and a one-time typing effect —
// visually matching the shared <PageHeader/> (same red left accent bar, same
// border/padding/type scale) but built standalone here rather than widening
// PageHeader's `title` prop to accept a client-side animated node, since
// PageHeader is reused by every other page in the app and this is scoped to
// the dashboard only.
//
// Hydration safety (Task 2): the greeting depends on the visitor's local
// browser time, which the server cannot know. The very first render —
// server-rendered HTML and the client's first paint before hydration's
// effects run — always shows the same time-independent fallback ("Good day,
// {name}"), so server and client markup match exactly. Only after mount does
// a `useEffect` resolve the real greeting, which is a post-hydration DOM
// update, not a mismatch.
//
// Top Navbar Clock Placement Unit 10G.20D, Task 1/2: this component used to
// also own a live clock (Units 10G.20/10G.20 Revised/10G.20B/10G.20C worked
// through its exact placement/size inside this dashboard-only header). The
// clock is now `components/layout/live-top-clock.tsx`, rendered once in the
// shared app top bar (`components/layout/app-layout.tsx`) so it's visible on
// every authenticated page, not just the dashboard. This component goes back
// to being the greeting only — no clock state, no clock JSX, no leftover
// empty strip above the greeting. The greeting/typing-effect logic below is
// otherwise byte-for-byte what Unit 10G.18 first wrote.

export interface LiveDashboardHeaderProps {
  profileName: string;
  subtitle: string;
  className?: string;
}

const TYPING_SPEED_MS = 45;

function greetingForHour(hour: number): string {
  // 5:00–11:59 morning, 12:00–16:59 afternoon, 17:00–4:59 evening.
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

export function LiveDashboardHeader({ profileName, subtitle, className = "" }: LiveDashboardHeaderProps) {
  const [mounted, setMounted] = useState(false);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [typedLength, setTypedLength] = useState(0);
  const reducedMotionRef = useRef(false);

  // Mount-only: resolve the real greeting once. Matches the existing
  // setInterval-in-useEffect pattern already used elsewhere in this file's
  // history — kept as a one-shot resolve (no interval) now that the clock
  // (the only thing that needed a recurring 1s tick) has moved out. Still
  // wrapped in a local function rather than called directly at the top of
  // the effect body, matching the codebase's established set-state-in-effect
  // lint-clean pattern.
  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    const resolveGreeting = () => {
      setGreeting(greetingForHour(new Date().getHours()));
      setMounted(true);
    };
    resolveGreeting();
  }, []);

  const fullText = `${greeting ?? "Good day"}, ${profileName}`;

  // Typing effect (Task 3) — runs once as soon as the real greeting is
  // known, then stops; under prefers-reduced-motion it skips straight to
  // the full text instead of animating.
  useEffect(() => {
    if (!mounted) return;
    if (reducedMotionRef.current) {
      const showFull = () => setTypedLength(fullText.length);
      showFull();
      return;
    }
    const reset = () => setTypedLength(0);
    reset();
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTypedLength(i);
      if (i >= fullText.length) clearInterval(id);
    }, TYPING_SPEED_MS);
    return () => clearInterval(id);
  }, [mounted, fullText]);

  const displayedGreeting = mounted ? fullText.slice(0, typedLength) : `Good day, ${profileName}`;

  return (
    <div className={`border-b border-[#DDE2EA] bg-white px-4 py-4 sm:px-6 sm:py-6 ${className}`}>
      <div className="min-w-0 border-l-4 border-[#ED1C24] pl-4">
        <h1 className="text-2xl font-black tracking-tight text-[#111827] sm:text-3xl">
          {displayedGreeting}
        </h1>
        <p className="mt-2 hidden max-w-3xl text-sm leading-6 text-[#4B5563] sm:block">{subtitle}</p>
      </div>
    </div>
  );
}
