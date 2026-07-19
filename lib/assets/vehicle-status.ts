// Shared expiry-status logic for vehicle documents (insurance, registration).
// Used by both the dedicated /assets/vehicles view and the asset detail
// page's Vehicle Information section so the two never disagree on what
// counts as "expiring soon" vs. "expired".

export type ExpiryStatusLabel = "Valid" | "Expiring Soon" | "Expired" | "Missing";

export type ExpiryStatus = {
  status: ExpiryStatusLabel;
  daysRemaining: number | null;
  tone: "green" | "amber" | "red" | "gray";
};

const EXPIRING_SOON_WINDOW_DAYS = 30;

export function getExpiryStatus(date: Date | string | null | undefined): ExpiryStatus {
  if (!date) return { status: "Missing", daysRemaining: null, tone: "gray" };

  const target = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(target.getTime())) return { status: "Missing", daysRemaining: null, tone: "gray" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const daysRemaining = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (daysRemaining < 0) return { status: "Expired", daysRemaining, tone: "red" };
  if (daysRemaining <= EXPIRING_SOON_WINDOW_DAYS) return { status: "Expiring Soon", daysRemaining, tone: "amber" };
  return { status: "Valid", daysRemaining, tone: "green" };
}

// Expiry filter values used on the /assets/vehicles list — a superset of the
// simple 30-day "Expiring Soon" badge threshold, since the filter dropdown
// lets users pick a specific renewal-planning horizon (60/30/15 days).
export type ExpiryFilterValue =
  | "all"
  | "expiring_60"
  | "expiring_30"
  | "expiring_15"
  | "expired"
  | "missing";

export const EXPIRY_FILTER_OPTIONS: { value: ExpiryFilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "expiring_60", label: "Expiring in 60 days" },
  { value: "expiring_30", label: "Expiring in 30 days" },
  { value: "expiring_15", label: "Expiring in 15 days" },
  { value: "expired", label: "Expired" },
  { value: "missing", label: "Missing date" },
];

// True when `date` matches the selected expiry filter. `date` is a raw
// nullable Date as read from the database (UTC midnight, per Prisma's
// `@db.Date` mapping).
export function matchesExpiryFilter(date: Date | null, filter: ExpiryFilterValue): boolean {
  if (filter === "all") return true;
  if (filter === "missing") return date === null;
  if (date === null) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const daysRemaining = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (filter === "expired") return daysRemaining < 0;
  if (filter === "expiring_60") return daysRemaining >= 0 && daysRemaining <= 60;
  if (filter === "expiring_30") return daysRemaining >= 0 && daysRemaining <= 30;
  if (filter === "expiring_15") return daysRemaining >= 0 && daysRemaining <= 15;
  return true;
}
