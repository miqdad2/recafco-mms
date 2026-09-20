// Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B, Task 1.
// Rebuilt around a Salary Cost Input Method in Worker Salary Cost Method and
// Rate Calculation Unit 10G.68.
//
// Deliberately NOT marked "server-only" — computeSalary/noSalary back the
// server-side writes in lib/backend/workers/service.ts, but this module's
// pure helpers (resolveSalaryMethod, isSalaryPending, salaryMethodLabel,
// salaryStatusLabel, computeDailyRate, the DEFAULT_* constants) are also
// needed by client components (the worker profile form's live preview, and
// the Worker Profiles table's Salary Status/Method badges) — same split
// rationale as lib/assets/asset-excel-mapping.ts (pure computation, safe
// either side).
//
// Single source of truth for the salary → hourly rate math, used by both
// createWorkerProfile and updateWorkerProfile (lib/backend/workers/service.ts)
// so the two write paths can never disagree on how a rate is derived, and by
// the form's own live preview so what the Manager sees before saving always
// matches what the server will actually store.
//
// Whichever method is selected, hourly_rate is the one number every other
// part of the app reads for Job Card labor cost (work_order_worker_assignments
// / work_order_work_sessions snapshot it at assignment time and never read it
// again) — this module's only job is deciding, from the chosen method, what
// that number should be. The legacy allowance breakdown (basic/transport/
// accommodation/food -> total_salary) still exists and is still summed here
// exactly as before (Task 5's "keep them optional, do not let them conflict"),
// but no longer feeds hourly_rate at all under the yearly_cost/monthly_cost
// methods — only a manual_hourly_rate submission (or the legacy pre-10G.68
// data this unit's migration already normalized into one of the three real
// methods) ever sets hourly_rate directly.

export const DEFAULT_MONTHLY_WORKING_HOURS = 260;
export const DEFAULT_MONTHLY_WORKING_DAYS = 26;

export const SALARY_INPUT_METHODS = ["yearly_cost", "monthly_cost", "manual_hourly_rate"] as const;
export type SalaryInputMethod = (typeof SALARY_INPUT_METHODS)[number];

export function isSalaryInputMethod(value: string | null | undefined): value is SalaryInputMethod {
  return !!value && (SALARY_INPUT_METHODS as readonly string[]).includes(value);
}

export const SALARY_METHOD_LABELS: Record<SalaryInputMethod, string> = {
  yearly_cost: "Yearly Cost",
  monthly_cost: "Monthly Cost",
  manual_hourly_rate: "Manual Rate",
};

export type SalaryInputs = {
  salaryInputMethod?: SalaryInputMethod;
  yearlyCost?: number;
  monthlyCost?: number;
  // The Manual Hourly Rate method's own directly-entered value. (Named
  // `hourlyRate`, not `manualHourlyRate`, so the existing `hourly_rate` form
  // field / zod key can be reused unchanged for this method's input.)
  hourlyRate?: number;
  manualHourlyRateReason?: string;
  monthlyWorkingDays?: number;
  monthlyWorkingHours?: number;
  // Legacy allowance breakdown — optional, informational only (Task 5);
  // still summed into totalSalary below, but never used to derive
  // hourlyRate under yearly_cost/monthly_cost.
  basicSalary?: number;
  transportAllowance?: number;
  accommodationAllowance?: number;
  foodAllowance?: number;
};

export type ComputedSalary = {
  salaryInputMethod: SalaryInputMethod;
  // The entered basis for the active method — null for manual_hourly_rate
  // (that method's "estimated" figures are computed on read, not stored).
  yearlyCost: number | null;
  monthlyCost: number | null;
  monthlyWorkingDays: number;
  monthlyWorkingHours: number;
  manualHourlyRateReason: string | null;
  hourlyRate: number;
  // Legacy fields — unchanged shape/meaning from before this unit.
  basicSalary: number;
  transportAllowance: number;
  accommodationAllowance: number;
  foodAllowance: number;
  totalSalary: number;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function positiveOrZero(n: number | undefined): number {
  return n && n > 0 ? round3(n) : 0;
}

/** Task 2/3 — Daily Rate is always derived, never stored: monthlyCost / monthlyWorkingDays. */
export function computeDailyRate(monthlyCost: number, monthlyWorkingDays: number): number {
  return monthlyCost > 0 && monthlyWorkingDays > 0 ? round3(monthlyCost / monthlyWorkingDays) : 0;
}

export function computeSalary(input: SalaryInputs): ComputedSalary {
  const method: SalaryInputMethod = input.salaryInputMethod ?? "yearly_cost";
  const monthlyWorkingDays =
    input.monthlyWorkingDays && input.monthlyWorkingDays > 0 ? input.monthlyWorkingDays : DEFAULT_MONTHLY_WORKING_DAYS;
  const monthlyWorkingHours =
    input.monthlyWorkingHours && input.monthlyWorkingHours > 0 ? input.monthlyWorkingHours : DEFAULT_MONTHLY_WORKING_HOURS;

  // Legacy allowance breakdown — summed exactly as before this unit
  // (Task 5's "keep them optional"), but this total is no longer read by
  // the branches below at all.
  const basicSalary = positiveOrZero(input.basicSalary);
  const transportAllowance = positiveOrZero(input.transportAllowance);
  const accommodationAllowance = positiveOrZero(input.accommodationAllowance);
  const foodAllowance = positiveOrZero(input.foodAllowance);
  const totalSalary = round3(basicSalary + transportAllowance + accommodationAllowance + foodAllowance);

  let yearlyCost: number | null = null;
  let monthlyCost: number | null = null;
  let hourlyRate = 0;
  let manualHourlyRateReason: string | null = null;

  if (method === "monthly_cost") {
    const mc = positiveOrZero(input.monthlyCost);
    monthlyCost = mc > 0 ? mc : null;
    yearlyCost = mc > 0 ? round3(mc * 12) : null;
    hourlyRate = mc > 0 ? round3(mc / monthlyWorkingHours) : 0;
  } else if (method === "manual_hourly_rate") {
    hourlyRate = positiveOrZero(input.hourlyRate);
    manualHourlyRateReason = input.manualHourlyRateReason?.trim() || null;
    // yearlyCost/monthlyCost stay null — this method's Estimated Monthly/
    // Yearly/Daily figures are computed on read (see computeSalary's
    // caller / the form's own live preview), never persisted as if they
    // were an entered basis value.
  } else {
    // yearly_cost (also the default for a brand-new profile — Task 1).
    const yc = positiveOrZero(input.yearlyCost);
    yearlyCost = yc > 0 ? yc : null;
    const mc = yc > 0 ? round3(yc / 12) : 0;
    monthlyCost = mc > 0 ? mc : null;
    hourlyRate = mc > 0 ? round3(mc / monthlyWorkingHours) : 0;
  }

  return {
    salaryInputMethod: method,
    yearlyCost,
    monthlyCost,
    monthlyWorkingDays,
    monthlyWorkingHours,
    manualHourlyRateReason,
    hourlyRate,
    basicSalary,
    transportAllowance,
    accommodationAllowance,
    foodAllowance,
    totalSalary,
  };
}

// Data Entry-created profiles (and anything a non-Manager submits) always
// get this — Task 2's "salary fields default to 0/null, hourly_rate
// defaults to 0" (unchanged rule, now expressed through the method fields
// too — Task 1's own "default Yearly Cost" applies here as well).
export function noSalary(): ComputedSalary {
  return {
    salaryInputMethod: "yearly_cost",
    yearlyCost: null,
    monthlyCost: null,
    monthlyWorkingDays: DEFAULT_MONTHLY_WORKING_DAYS,
    monthlyWorkingHours: DEFAULT_MONTHLY_WORKING_HOURS,
    manualHourlyRateReason: null,
    hourlyRate: 0,
    basicSalary: 0,
    transportAllowance: 0,
    accommodationAllowance: 0,
    foodAllowance: 0,
    totalSalary: 0,
  };
}

// Task 9 — "Set: if final hourly rate > 0. Pending: if no valid salary/
// cost/hourly rate is available." hourly_rate is the one number every
// method ultimately produces, so checking it alone is correct regardless of
// which method a worker is on. Callers gate this to Manager/Super Admin only
// (isManagerRole); Data Entry never sees the result.
export function isSalaryPending(w: { hourly_rate: number }): boolean {
  return !(w.hourly_rate > 0);
}

// Task 9 — "Salary Pending" / "Manual Rate" / "Set", the one status word a
// Manager sees in the Worker Profiles table and the form's own header badge.
export function salaryStatusLabel(w: { hourly_rate: number; salary_input_method: string | null }): "Salary Pending" | "Manual Rate" | "Set" {
  if (isSalaryPending(w)) return "Salary Pending";
  if (w.salary_input_method === "manual_hourly_rate") return "Manual Rate";
  return "Set";
}

// Task 9/11 — the small method badge ("Yearly Cost" / "Monthly Cost" /
// "Manual Rate"), shown only once a method is actually known (never for a
// worker with no salary data at all, where "Salary Pending" already says
// enough).
export function salaryMethodLabel(method: string | null | undefined): string | null {
  return isSalaryInputMethod(method) ? SALARY_METHOD_LABELS[method] : null;
}

// Worker Salary Cost Method and Rate Calculation Unit 10G.68, Task 8 —
// existing-worker compatibility for a profile saved before this unit (or
// one whose `salary_input_method` is somehow still missing): derives a
// sensible method + basis to show in the form on open, without needing any
// further backfill beyond what this unit's migration already did once for
// every row in the database. Exported so both the form (initial state) and
// any other future caller can resolve the same way.
export function resolveSalaryMethod(w: {
  salary_input_method: string | null;
  yearly_cost: number | null;
  monthly_cost: number | null;
  total_salary: number;
  hourly_rate: number;
}): { method: SalaryInputMethod; yearlyCost: number | null; monthlyCost: number | null } {
  if (isSalaryInputMethod(w.salary_input_method)) {
    return { method: w.salary_input_method, yearlyCost: w.yearly_cost, monthlyCost: w.monthly_cost };
  }
  // Task 8's three rules, for the rare case a row still has no method at
  // all (should not happen after this unit's migration, but keeps the form
  // robust rather than assuming the column is always populated).
  if (w.total_salary > 0) return { method: "monthly_cost", yearlyCost: null, monthlyCost: w.total_salary };
  if (w.hourly_rate > 0) return { method: "manual_hourly_rate", yearlyCost: null, monthlyCost: null };
  return { method: "yearly_cost", yearlyCost: null, monthlyCost: null };
}
