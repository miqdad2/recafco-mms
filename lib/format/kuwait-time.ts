// Kuwait time helpers (client-safe: no server-only / prisma import).
//
// Kuwait is UTC+3 all year (no daylight saving), the same fixed-offset rule
// lib/work-orders/daily-activity-status.ts's kuwaitDayRange relies on.
// Display always names the time zone explicitly (Asia/Kuwait) so it never
// depends on the server's or the browser's own time zone, and form values
// are exchanged as plain Kuwait wall-clock strings that the server parses
// with an explicit +03:00 offset — no silent conversion either way.

const KUWAIT_TIME_ZONE = "Asia/Kuwait";
const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
const INPUT_VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "26 Oct 2026, 2:05 PM" in Kuwait time; `fallback` for a missing/invalid value. */
export function formatKuwaitDateTime(value: Date | string | null | undefined, fallback = "Not recorded"): string {
  if (!value) return fallback;
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: KUWAIT_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

/** "26 Oct 2026" — the Kuwait calendar date only (a manual entry whose time was not entered). */
export function formatKuwaitDate(value: Date | string | null | undefined, fallback = "Not recorded"): string {
  if (!value) return fallback;
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", { timeZone: KUWAIT_TIME_ZONE, day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Kuwait date and time, or the date only when the time was not entered. */
export function formatKuwaitMoment(value: Date | string | null | undefined, timeKnown: boolean, fallback = "Not recorded"): string {
  return timeKnown ? formatKuwaitDateTime(value, fallback) : formatKuwaitDate(value, fallback);
}

/** A `<input type="datetime-local">` value ("2026-10-26T14:05") showing Kuwait wall-clock time. */
export function toKuwaitInputValue(value: Date | string): string {
  const shifted = new Date(toDate(value).getTime() + KUWAIT_OFFSET_MS);
  return shifted.toISOString().slice(0, 16);
}

/**
 * Parses a Kuwait wall-clock "YYYY-MM-DDTHH:mm" string into the exact
 * instant. Returns null for anything that is not a real calendar time
 * (e.g. 2026-02-30T10:00 or 25:00).
 */
export function parseKuwaitInputValue(value: string): Date | null {
  const match = INPUT_VALUE_RE.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const utcMs = Date.UTC(y, mo - 1, d, h, mi) - KUWAIT_OFFSET_MS;
  const date = new Date(utcMs);
  // Date.UTC rolls 30 Feb into March; a round trip catches that.
  if (toKuwaitInputValue(date) !== value.trim()) return null;
  return date;
}

/** "2 h 15 min", "45 min", "0 min". */
export function formatDurationMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
