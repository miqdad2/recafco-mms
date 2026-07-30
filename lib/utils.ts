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
