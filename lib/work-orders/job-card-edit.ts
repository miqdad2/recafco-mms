// Job Card Start / End Date and Job Card edit rules (client-safe, pure).
//
// Job Card Open Date and Job Card Closed Date are plain calendar dates that
// Data Entry types on the Job Card (work_orders.job_card_start_date /
// job_card_end_date, @db.Date). They are NOT worker time: nothing here or
// in the worker timer, manual time, correction, labor-hour or cost code
// reads them, and they are separate from the recorded Work Start / Work End
// in lib/work-orders/job-card-dates.ts. The same rules run in the New Job
// Card wizard (instant feedback), the shared form schema (server) and the
// work_orders_job_card_dates_check database constraint.

import { ACTIVE_JOB_CARD_STATUSES } from "@/lib/work-orders/simplified-status-display";

export const NOT_ENTERED = "Not entered";

// Statuses in which the Job Card edit form may save. Once closure is
// requested ("Closure Requested") or the card is Closed, request details are
// fixed and only the Manager's closure decision remains.
export const JOB_CARD_EDITABLE_STATUSES: readonly string[] = ["Created", "Under Review", ...ACTIVE_JOB_CARD_STATUSES];

export function isJobCardEditable(status: string): boolean {
  return JOB_CARD_EDITABLE_STATUSES.includes(status);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written as YYYY-MM-DD (what <input type="date"> sends). */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export type JobCardDateRangeProblem = { field: "job_card_start_date" | "job_card_end_date"; message: string };

export const JOB_CARD_DATE_MESSAGES = {
  invalidStart: "Please enter a valid Job Card Open Date.",
  invalidEnd: "Please enter a valid Job Card Closed Date.",
  endWithoutStart: "Please enter the Job Card Open Date before the Closed Date.",
  endBeforeStart: "Job Card Closed Date cannot be earlier than the Open Date.",
} as const;

/**
 * Both dates are optional. If End Date is entered, Start Date is required,
 * and End Date may not be earlier than Start Date (same day is allowed).
 * Values are YYYY-MM-DD strings; blank means not entered.
 */
export function checkJobCardDateRange(start: string | null | undefined, end: string | null | undefined): JobCardDateRangeProblem | null {
  const s = start?.trim() ?? "";
  const e = end?.trim() ?? "";
  if (s && !isIsoDate(s)) return { field: "job_card_start_date", message: JOB_CARD_DATE_MESSAGES.invalidStart };
  if (e && !isIsoDate(e)) return { field: "job_card_end_date", message: JOB_CARD_DATE_MESSAGES.invalidEnd };
  if (e && !s) return { field: "job_card_start_date", message: JOB_CARD_DATE_MESSAGES.endWithoutStart };
  // ISO dates compare correctly as strings.
  if (s && e && e < s) return { field: "job_card_end_date", message: JOB_CARD_DATE_MESSAGES.endBeforeStart };
  return null;
}

/** A @db.Date value (stored as UTC midnight) or YYYY-MM-DD string → YYYY-MM-DD, else null. */
export function toIsoDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return isIsoDate(value.slice(0, 10)) ? value.slice(0, 10) : null;
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "28 Oct 2026", or "Not entered". A calendar date has no time zone, so none is applied. */
export function formatJobCardDate(value: Date | string | null | undefined, fallback = NOT_ENTERED): string {
  const iso = toIsoDateOnly(value);
  if (!iso) return fallback;
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// ── Line items on the edit form ─────────────────────────────────────────────
// The Job Card edit form re-posts only a few visible fields of each line-item
// table (labor 3 rows, materials 3, required materials up to 8, attachments
// 2), and the save used to delete and re-create every table on every save.
// That silently reset required-material availability / inventory key / unit
// conversion and dropped attachments beyond the 2 shown — even when the user
// only changed a date. A table is now replaced only when what was posted
// differs from what the form showed: the first `formSlots` existing rows (in
// the edit page's order), compared on the posted fields.

export function lineItemsUnchanged(posted: unknown[][], existing: unknown[][], formSlots: number): boolean {
  const shown = existing.slice(0, formSlots);
  return posted.length === shown.length && posted.every((row, i) => JSON.stringify(row) === JSON.stringify(shown[i]));
}

// ── Edit audit trail ────────────────────────────────────────────────────────
// The Job Card edit action snapshots these fields (as display text) before
// and after the save and stores only what changed in the audit row's
// metadata.changes, so History can show "old → new", who and when. No cost
// field is in this list.

export const JOB_CARD_EDIT_AUDIT_FIELDS = [
  ["ordered_by", "Order taken by"],
  ["department", "Department"],
  ["asset", "Asset"],
  ["asset_category", "Asset category"],
  ["serial_number", "Serial number"],
  ["plate_number", "Plate number"],
  ["date_of_order", "Date of order"],
  ["job_card_start_date", "Job Card Open Date"],
  ["job_card_end_date", "Job Card Closed Date"],
  ["job_location", "Job location"],
  ["starting_datetime", "Starting date/time"],
  ["ending_datetime", "Ending date/time"],
  ["maintenance_type", "Maintenance type"],
  ["worker_type", "Worker type"],
  ["priority", "Priority"],
  ["running_hours", "Running hours"],
  ["kilometers", "Kilometers"],
  ["estimated_labor_hours", "Estimated total work hours"],
  ["operator_complaint", "Operator complaint"],
  ["description_of_work", "Description of work"],
  ["notes", "Notes"],
  ["next_service_date", "Next service date"],
  ["next_service_kilometer", "Next service kilometer"],
  ["next_service_running_hours", "Next service running hours"],
] as const;

export type JobCardEditAuditField = (typeof JOB_CARD_EDIT_AUDIT_FIELDS)[number][0];
export type JobCardEditSnapshot = Record<JobCardEditAuditField, string | null>;
export type JobCardEditChange = { field: JobCardEditAuditField; label: string; from: string; to: string };

const MAX_AUDIT_TEXT = 300;

function auditText(value: string | null): string {
  const v = value?.trim() ?? "";
  if (!v) return NOT_ENTERED;
  return v.length > MAX_AUDIT_TEXT ? `${v.slice(0, MAX_AUDIT_TEXT - 1)}…` : v;
}

export function diffJobCardEdit(before: JobCardEditSnapshot, after: JobCardEditSnapshot): JobCardEditChange[] {
  const changes: JobCardEditChange[] = [];
  for (const [field, label] of JOB_CARD_EDIT_AUDIT_FIELDS) {
    const from = auditText(before[field]);
    const to = auditText(after[field]);
    if (from !== to) changes.push({ field, label, from, to });
  }
  return changes;
}

const CURRENT_AUDIT_LABELS = new Map<string, string>(JOB_CARD_EDIT_AUDIT_FIELDS);

/**
 * Reads metadata.changes back from an audit row; anything malformed is
 * skipped. A known field is shown with its current label (e.g. rows saved
 * as "Job Card Start Date" read as "Job Card Open Date"); the stored audit
 * row itself is never changed.
 */
export function readJobCardEditChanges(metadata: unknown): JobCardEditChange[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as { changes?: unknown }).changes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is JobCardEditChange =>
        !!c && typeof c === "object" && typeof c.label === "string" && typeof c.from === "string" && typeof c.to === "string"
    )
    .map((c) => ({ ...c, label: CURRENT_AUDIT_LABELS.get(c.field) ?? c.label }));
}
