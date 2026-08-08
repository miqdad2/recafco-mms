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

const navBtnClass =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-bold text-[#4B5563] transition hover:border-[#2563EB] hover:text-[#2563EB]";

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
        <button type="button" onClick={handleBack} className={navBtnClass}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
        </button>
      ) : null}
      <Link href={dashboardHref} className={navBtnClass}>
        <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" /> Dashboard
      </Link>
      {showDailyActivity ? (
        <Link href="/maintenance/daily-activity" className={navBtnClass}>
          <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Daily Activity
        </Link>
      ) : null}
      {showJobCards ? (
        <Link href="/maintenance/work-orders" className={navBtnClass}>
          <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" /> Job Cards
        </Link>
      ) : null}
      {secondaryLinks.map((link) => (
        <Link key={link.href} href={link.href} className={navBtnClass}>
          {link.icon ? <link.icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {link.label}
        </Link>
      ))}
    </div>
  );
}
