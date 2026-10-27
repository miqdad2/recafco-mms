"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LayoutDashboard, Activity, ClipboardList, type LucideIcon } from "lucide-react";

// Manager Closed Job Cards Summary and Global Navigation Improvements Unit
// 10E, Part B.
//
// A small, consistent "how do I get around" bar for pages that don't
// otherwise offer an easy way back to Dashboard/Daily Activity/Job Cards —
// dropped into a page's existing PageHeader `actions` slot (or inline, for
// the handful of pages that use a custom slim header instead of PageHeader,
// e.g. Daily Activity, Worker Activity). Deliberately NOT a replacement for
// every page's own more specific navigation (breadcrumbs, "Open Full Job
// Card" links inside a modal, etc.) — just the four common anchors every
// role asked for, plus whatever page-specific extras the caller passes.
//
// Task 9 — Back uses real browser history (router.back()) when there's
// somewhere to go back TO, falling back to Dashboard when this page was
// opened directly (no history) — a client-only concern, hence "use client".

export type PageNavSecondaryLink = { label: string; href: string; icon?: LucideIcon };

// Colored, raised buttons (not plain white outlines) so they read as
// clickable at a glance; one color per destination, same everywhere this bar
// is used. 44px tall on phones (mobile touch target), compact from sm: up.
const navBtnBase =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold shadow-sm transition hover:shadow active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0 sm:min-h-9";
const NAV_BTN_TONE = {
  back: "border-[#2b2b2b] bg-[#2b2b2b] text-white hover:bg-[#111827]",
  dashboard: "border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-300 hover:bg-blue-100",
  dailyActivity: "border-green-200 bg-green-50 text-green-800 hover:border-green-300 hover:bg-green-100",
  jobCards: "border-red-200 bg-red-50 text-[#B91C1C] hover:border-red-300 hover:bg-red-100",
  secondary: "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100",
} as const;
const navBtnClass = (tone: keyof typeof NAV_BTN_TONE) => `${navBtnBase} ${NAV_BTN_TONE[tone]}`;

export function PageNavigationActions({
  showBack = true,
  dashboardHref = "/dashboard",
  showDailyActivity = true,
  showJobCards = true,
  secondaryLinks = [],
}: {
  showBack?: boolean;
  dashboardHref?: string;
  // Task 10 — role-safe: the caller (a page that already knows the current
  // user's permissions) decides whether these apply; both default to true
  // since every page this component is added to already requires at least
  // work_orders.view-equivalent access to load in the first place.
  showDailyActivity?: boolean;
  showJobCards?: boolean;
  // Page-specific extras beyond the four common anchors (Materials
  // Requests, Offline Inventory Control, Worker Activity, Reports, etc.) —
  // each caller passes only the ones its own role/page context allows.
  secondaryLinks?: PageNavSecondaryLink[];
}) {
  const router = useRouter();

  function handleBack() {
    // Task 9 — real browser back when there's history to go back to;
    // window.history.length is 1 on a fresh tab/direct link, so that case
    // falls back to Dashboard instead of leaving the app entirely.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(dashboardHref);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showBack ? (
        <button type="button" onClick={handleBack} className={navBtnClass("back")}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
        </button>
      ) : null}
      <Link href={dashboardHref} className={navBtnClass("dashboard")}>
        <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" /> Dashboard
      </Link>
      {showDailyActivity ? (
        <Link href="/maintenance/daily-activity" className={navBtnClass("dailyActivity")}>
          <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Daily Activity
        </Link>
      ) : null}
      {showJobCards ? (
        <Link href="/maintenance/work-orders" className={navBtnClass("jobCards")}>
          <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" /> Job Cards
        </Link>
      ) : null}
      {secondaryLinks.map((link) => (
        <Link key={link.href} href={link.href} className={navBtnClass("secondary")}>
          {link.icon ? <link.icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {link.label}
        </Link>
      ))}
    </div>
  );
}
