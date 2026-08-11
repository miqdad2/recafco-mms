// Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 5/6/8/9.
//
// Client-safe half of the estimated-vs-actual classifier (no "server-only"/
// prisma import), split out for the same reason lib/work-orders/
// simplified-status-display.ts was split from simplified-status.ts: pure
// display/comparison logic that CLIENT components (ClosureReviewModal,
// WorkerSessionRow, Closed Jobs modal, Worker Activity card) need to import
// directly, which they cannot do from lib/work-orders/work-session-totals.ts
// — that file starts with `import "server-only"`, which poisons every
// export from the module for any client bundle, not just the DB-touching
// ones. A single shared classifier here means every surface that shows
// "Estimated vs Actual" (Job Card detail, Daily Activity, Manager Closure
// Review, Closed Jobs, Worker Activity) uses the exact same On Track/
// Slightly Over/Over Estimate rule instead of five slightly-different
// re-derivations.
//
// Deliberately takes plain numbers, not a DB row — callers already have
// their own estimated hours (work_orders.estimated_labor_hours or
// WorkOrderWorkerAssignment.estimated_hours) and their own already-computed
// actual hours; this never re-derives actual hours itself, so it can never
// disagree with the real work-session totals it's comparing against.

// Manager Closure Review Estimated vs Actual Labor Transparency Unit
// 10G.21, Task 5: added "under_estimate" (actual < estimated * 0.8) — the
// original Unit 10G.13 classifier only had 4 states and folded that whole
// range into "on_track". "under_estimate" is checked before "on_track"
// since its range (< 0.8x) is a subset of "actual <= estimated" (<= 1.0x);
// everything from 0.8x up to and including 1.0x is still "on_track".
export type HoursVarianceStatus = "no_estimate" | "under_estimate" | "on_track" | "slightly_over" | "over_estimate";

export type HoursVariance = {
  status: HoursVarianceStatus;
  // actual - estimated, rounded to 2dp; null only when there's no estimate
  // to compare against (status "no_estimate").
  varianceHours: number | null;
  label: string;
};

const UNDER_ESTIMATE_THRESHOLD = 0.8; // Task 5: "< estimated * 0.8"
const SLIGHTLY_OVER_THRESHOLD = 1.2; // Task 5: "> estimated and <= estimated + 20%"

export function computeHoursVariance(estimatedHours: number | null | undefined, actualHours: number): HoursVariance {
  if (estimatedHours === null || estimatedHours === undefined) {
    return { status: "no_estimate", varianceHours: null, label: "No estimate recorded." };
  }
  const varianceHours = Math.round((actualHours - estimatedHours) * 100) / 100;
  // Rounded to 2dp (this app's standard hours precision, same as
  // varianceHours above) before comparing — a raw `estimatedHours * 0.8`
  // can land a hair past its true value in floating point (e.g.
  // `6 * 0.8 === 4.800000000000001`), which would otherwise misclassify an
  // exact boundary case like estimated=6/actual=4.8 as Under Estimate
  // instead of On Track.
  const underThreshold = Math.round(estimatedHours * UNDER_ESTIMATE_THRESHOLD * 100) / 100;
  const overThreshold = Math.round(estimatedHours * SLIGHTLY_OVER_THRESHOLD * 100) / 100;
  if (actualHours < underThreshold) return { status: "under_estimate", varianceHours, label: "Under Estimate" };
  if (actualHours <= estimatedHours) return { status: "on_track", varianceHours, label: "On Track" };
  if (actualHours <= overThreshold) return { status: "slightly_over", varianceHours, label: "Slightly Over" };
  return { status: "over_estimate", varianceHours, label: "Over Estimate" };
}

// Job Card Estimated Hours UX Simplification Unit 10G.22, Task 6: the Job
// Card-level total (work_orders.estimated_labor_hours) is now always
// computed from the sum of per-worker estimates at save time (see
// sumWorkerEstimates in app/actions/maintenance.ts), so for a Job Card
// created after this unit the saved total and the sum of its workers'
// estimates already agree. This fallback exists for the cases where they
// can still legitimately diverge: a Job Card created before this unit, or
// one whose workers were assigned/edited later from the roster form
// (lib/backend/work-orders/worker-roster.ts never recomputes the Job Card
// total) — every Manager-facing "Estimated" figure stays accurate without
// requiring a separately re-typed total.
export function resolveEstimatedTotalHours(
  workOrderEstimatedHours: number | null,
  workerEstimatedHours: Array<number | null>
): number | null {
  if (workOrderEstimatedHours !== null) return workOrderEstimatedHours;
  const entered = workerEstimatedHours.filter((h): h is number => h !== null);
  if (entered.length === 0) return null;
  return Math.round(entered.reduce((sum, h) => sum + h, 0) * 100) / 100;
}

// Same status -> tone mapping every surface's own StatusBadge/badge-tone
// helper can delegate to, instead of re-deriving it locally.
export function hoursVarianceTone(status: HoursVarianceStatus): "green" | "amber" | "red" | "gray" {
  if (status === "on_track") return "green";
  if (status === "slightly_over" || status === "under_estimate") return "amber";
  if (status === "over_estimate") return "red";
  return "gray";
}
