// Asset Site Movement / Deployment Tracking Unit 10G.65, Task 4/6/7/8.
//
// Plain, framework-agnostic day-count helpers shared by both server
// components (Asset Detail page, Assets list) and client components
// (Asset Type Cards popup) — deliberately NOT "server-only" so the client
// side can compute the same badge from data already loaded in memory
// without an extra request.

// Assets Page Card-First Register UI Unit 10G.67, Task 3/4 — the sentinel
// `asset_type`/`openType` value meaning "View All Assets" rather than one
// specific category. Lives in this plain (non-"use client") module, not
// components/assets/asset-type-cards.tsx, specifically so the server page
// component can use it directly as a string value: importing even a plain
// constant from a "use client" file resolves to an opaque client-reference
// stub when used outside JSX/props on the server, not its real value.
export const ALL_ASSET_TYPES_KEY = "__all__";

export type ActiveMovementInfo = {
  /** Optional — only present where the caller loaded it (e.g. to target a specific movement for Receive Back without a per-row query). */
  id?: string;
  to_location: string;
  sent_date: string | Date;
  expected_return_date: string | Date | null;
};

export type MovementDayInfo = {
  /** Active: days since sent_date. Returned: total days sent_date -> actual_return_date. */
  daysOutside: number;
  isOverdue: boolean;
  /** Only meaningful when isOverdue is true. */
  overdueDays: number;
  /** Only set when active, has an expected_return_date, and is not yet overdue. */
  daysUntilExpectedReturn: number | null;
};

function toDateOnly(d: string | Date): Date {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Calendar-day difference (b - a), using UTC date-only components. */
export function daysBetween(a: string | Date, b: string | Date): number {
  const utcA = toDateOnly(a).getTime();
  const utcB = toDateOnly(b).getTime();
  return Math.round((utcB - utcA) / 86_400_000);
}

export function computeMovementDayInfo(
  movement: {
    status: string;
    sent_date: string | Date;
    expected_return_date: string | Date | null;
    actual_return_date: string | Date | null;
  },
  now: Date = new Date()
): MovementDayInfo {
  if (movement.status === "RETURNED" && movement.actual_return_date) {
    return {
      daysOutside: Math.max(0, daysBetween(movement.sent_date, movement.actual_return_date)),
      isOverdue: false,
      overdueDays: 0,
      daysUntilExpectedReturn: null,
    };
  }

  const daysOutside = Math.max(0, daysBetween(movement.sent_date, now));

  if (movement.expected_return_date) {
    const overdue = daysBetween(movement.expected_return_date, now);
    if (overdue > 0) {
      return { daysOutside, isOverdue: true, overdueDays: overdue, daysUntilExpectedReturn: null };
    }
    return { daysOutside, isOverdue: false, overdueDays: 0, daysUntilExpectedReturn: Math.max(0, -overdue) };
  }

  return { daysOutside, isOverdue: false, overdueDays: 0, daysUntilExpectedReturn: null };
}

export type MovementBadge = { label: "At Site" | "Overdue"; tone: "blue" | "red" };

/** Task 7/8 — the compact badge shown near Location in lists/popups. Returns null when the asset has no active deployment (i.e. show nothing). */
export function getMovementBadge(active: ActiveMovementInfo | null, now: Date = new Date()): MovementBadge | null {
  if (!active) return null;
  const info = computeMovementDayInfo(
    { status: "ACTIVE", sent_date: active.sent_date, expected_return_date: active.expected_return_date, actual_return_date: null },
    now
  );
  return info.isOverdue ? { label: "Overdue", tone: "red" } : { label: "At Site", tone: "blue" };
}
