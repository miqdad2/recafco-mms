// Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B, Task 1.
//
// Deliberately NOT marked "server-only" — computeSalary/noSalary back the
// server-side writes in lib/backend/workers/service.ts, but isSalaryPending
// and DEFAULT_MONTHLY_WORKING_HOURS are also needed by client components
// (the worker profile form's live Total Salary/Hourly Rate preview, and the
// Worker Profiles table's "Salary Pending" badge) — same split rationale as
// lib/assets/asset-excel-mapping.ts (pure computation, safe either side).
//
// Single source of truth for the salary → hourly rate math, used by both
// createWorkerProfile and updateWorkerProfile (lib/backend/workers/service.ts)
// so the two write paths can never disagree on how a rate is derived.
//
// total_salary is always recomputed here from its four parts — never
// trusted from client input — so it can never drift out of sync with
// basic/transport/accommodation/food. hourly_rate is auto-calculated as
// total_salary ÷ monthly_working_hours, falling back to 0 whenever either is
// missing/zero (Task 1's exact rule), unless the caller explicitly typed a
// different, positive hourly rate — Task 3's "Manager can override hourly
// rate" — in which case that value is kept as-is.

export const DEFAULT_MONTHLY_WORKING_HOURS = 260;

export type SalaryInputs = {
  basicSalary?: number;
  transportAllowance?: number;
  accommodationAllowance?: number;
  foodAllowance?: number;
  monthlyWorkingHours?: number;
  // Manager-submitted hourly rate, if any — used as an override when it's a
  // positive number that doesn't match what auto-calculation would produce.
  hourlyRate?: number;
};

export type ComputedSalary = {
  basicSalary: number;
  transportAllowance: number;
  accommodationAllowance: number;
  foodAllowance: number;
  totalSalary: number;
  monthlyWorkingHours: number;
  hourlyRate: number;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function computeSalary(input: SalaryInputs): ComputedSalary {
  const basicSalary = round3(input.basicSalary ?? 0);
  const transportAllowance = round3(input.transportAllowance ?? 0);
  const accommodationAllowance = round3(input.accommodationAllowance ?? 0);
  const foodAllowance = round3(input.foodAllowance ?? 0);
  const totalSalary = round3(basicSalary + transportAllowance + accommodationAllowance + foodAllowance);
  const monthlyWorkingHours =
    input.monthlyWorkingHours && input.monthlyWorkingHours > 0
      ? input.monthlyWorkingHours
      : DEFAULT_MONTHLY_WORKING_HOURS;
  const autoHourlyRate = totalSalary > 0 && monthlyWorkingHours > 0 ? round3(totalSalary / monthlyWorkingHours) : 0;
  const hourlyRate = input.hourlyRate && input.hourlyRate > 0 ? round3(input.hourlyRate) : autoHourlyRate;

  return { basicSalary, transportAllowance, accommodationAllowance, foodAllowance, totalSalary, monthlyWorkingHours, hourlyRate };
}

// Data Entry-created profiles (and anything a non-Manager submits) always
// get this — Task 2's "salary fields default to 0/null, hourly_rate
// defaults to 0."
export function noSalary(): ComputedSalary {
  return {
    basicSalary: 0,
    transportAllowance: 0,
    accommodationAllowance: 0,
    foodAllowance: 0,
    totalSalary: 0,
    monthlyWorkingHours: DEFAULT_MONTHLY_WORKING_HOURS,
    hourlyRate: 0,
  };
}

// Task 4 — "If total salary is 0 or hourly rate is 0, show badge: Salary
// Pending." Callers gate this to Manager/Super Admin only (isManagerRole);
// Data Entry never sees the result.
export function isSalaryPending(w: { total_salary: number; hourly_rate: number }): boolean {
  return w.total_salary === 0 || w.hourly_rate === 0;
}
