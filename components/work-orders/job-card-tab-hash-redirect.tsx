"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Job Card Detail Tab-Based Layout Redesign Unit 10F, Task 10.
//
// Before this unit, the Job Card detail page was one long scroll and several
// other pages/popups link straight into a specific part of it via a plain
// hash fragment: #assignment, #work-time-tracking, #parts, #closure-panel
// (Manager dashboard's attention board, Daily Activity's card, the Job Cards
// list, the repair-order quick-view popup — confirmed by a full-codebase
// grep before this unit). Now that section only renders when its tab is
// active, a bare hash fragment no longer lands anywhere on its own — this
// component runs once per page load (and on any same-page hash change, for
// robustness) and rewrites the URL to the matching `?tab=` value, which the
// server component reads to decide what to render. It does NOT touch this
// page's own internal links (Next Action ladder, Edit Assignment, etc.) —
// those were updated to use `?tab=` directly, since a hash-only link can't
// reliably trigger a fresh render if the user is already on this exact page.
// Renders nothing.

const HASH_TO_TAB: Record<string, string> = {
  "#assignment": "assignment",
  "#work-time-tracking": "assignment",
  "#parts": "materials",
  "#materials": "materials",
  "#closure-panel": "closure",
};

export function JobCardTabHashRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    function syncFromHash() {
      const mappedTab = HASH_TO_TAB[window.location.hash];
      if (!mappedTab) return;
      if (searchParams.get("tab") === mappedTab) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", mappedTab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
