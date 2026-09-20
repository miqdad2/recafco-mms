// Printable Division-Based Reports Foundation Unit 10G.69, Task 2.
//
// Plain, framework-agnostic date-range preset resolver — not "server-only"
// so the print pages' own screen-only filter bar (a client component) can
// show the same resolved From/To dates a server component computed, without
// duplicating the logic. All dates are plain "yyyy-mm-dd" strings (date-only,
// no time component), matching how every filter/date input in this app
// already works.

export const DATE_RANGE_PRESETS = ["today", "this_week", "this_month", "last_month", "this_year", "custom"] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  this_week: "This Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_year: "This Year",
  custom: "Custom",
};

export function isDateRangePreset(value: string | null | undefined): value is DateRangePreset {
  return !!value && (DATE_RANGE_PRESETS as readonly string[]).includes(value);
}

function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Resolves a preset (or "custom" + explicit from/to) into a concrete
 * { from, to } date-only range. "Custom" with no from/to falls back to
 * "This Month" so a report never silently runs with an unbounded range just
 * because the two date inputs were left blank.
 */
export function resolveDateRange(preset: DateRangePreset, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  switch (preset) {
    case "today": {
      const d = toDateOnly(now);
      return { from: d, to: d };
    }
    case "this_week": {
      // Monday-start week, matching this app's own working-week convention
      // elsewhere (Monthly Working Days schedules, etc.).
      const day = now.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const monday = startOfDay(new Date(now));
      monday.setDate(monday.getDate() - diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: toDateOnly(monday), to: toDateOnly(sunday) };
    }
    case "this_month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: toDateOnly(first), to: toDateOnly(last) };
    }
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toDateOnly(first), to: toDateOnly(last) };
    }
    case "this_year": {
      const first = new Date(now.getFullYear(), 0, 1);
      const last = new Date(now.getFullYear(), 11, 31);
      return { from: toDateOnly(first), to: toDateOnly(last) };
    }
    case "custom":
    default: {
      if (customFrom && customTo) return { from: customFrom, to: customTo };
      // No explicit custom range given — fall back to This Month rather
      // than running an unbounded query.
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: customFrom || toDateOnly(first), to: customTo || toDateOnly(last) };
    }
  }
}
