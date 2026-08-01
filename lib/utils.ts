import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

// Materials Requests Requested Date & Time Column Cleanup: an exact,
// unambiguous "DD MMM YYYY, hh:mm AM/PM" timestamp (e.g. "30 Jul 2026, 11:48
// AM") — used wherever relative wording ("Today", "2 days ago") needs to be
// replaced with a precise value for tracking/reporting. Intl's en-GB
// day-month-year ordering gives the right date shape; the am/pm marker is
// forced uppercase since en-GB otherwise renders it lowercase.
export function formatExactDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "-";
  }

  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));

  return formatted.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

// Users Page Monitoring Accuracy Unit: users who logged in before
// login_count/last_active_at existed (added by migration
// 20260801000000_login_activity_tracking) have a real last_login_at but a
// login_count of 0 and a null last_active_at — not a bug, just history that
// predates the columns. Rather than backfilling (a write to every historical
// row for a purely cosmetic gap), these two helpers resolve a display value
// that never contradicts last_login_at. The underlying DB values are never
// changed.
export function resolveDisplayLoginCount(
  loginCount: number | null | undefined,
  lastLoginAt: Date | string | null | undefined
) {
  const count = loginCount ?? 0;
  if (lastLoginAt && count < 1) return 1;
  return count;
}

export function resolveLastSeen(
  lastActiveAt: Date | string | null | undefined,
  lastLoginAt: Date | string | null | undefined
) {
  return lastActiveAt ?? lastLoginAt ?? null;
}

export function initials(name: string | null | undefined) {
  if (!name) {
    return "RC";
  }

  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
