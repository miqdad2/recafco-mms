// New Job Card Wizard Cleanup Unit Task 2: the previous 7-option list
// (Routine/Service/Breakdown/Preventive/Inspection/Emergency/Other) was
// replaced with this shorter, business-approved list. `maintenance_type` is a
// plain string column with no DB check constraint, so this is UI-only —
// existing records still holding an old value (e.g. "Preventive") remain
// valid and continue to display exactly as stored.
export const MAINTENANCE_TYPES = ["Repair", "Routine", "Service", "Break Down", "Other"];

export const DEFAULT_MAINTENANCE_TYPE = "Break Down";

// "Breakdown" (no space) was the old value for this same concept, renamed to
// "Break Down" going forward. Report/stat filters should count both so a
// mix of pre- and post-rename records isn't silently undercounted.
export function isBreakdownMaintenanceType(value: string | null | undefined): boolean {
  return value === "Break Down" || value === "Breakdown";
}
