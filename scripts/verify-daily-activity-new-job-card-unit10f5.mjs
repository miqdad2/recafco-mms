/**
 * Daily Activity New Job Card Visibility and Timestamp Polish Unit 10F.5 —
 * verification script.
 *
 * Pure logic only — no database needed. `app/(dashboard)/maintenance/
 * daily-activity/page.tsx` is a Server Component tied to the real request
 * context, and `daily-activity-card.tsx` is presentational React — neither
 * can be imported into a standalone Node script. This mirrors
 * formatCreatedLabel/isRecentlyCreated exactly as written in page.tsx.
 *
 * Usage:
 *   node scripts/verify-daily-activity-new-job-card-unit10f5.mjs
 */

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// Mirrors formatCreatedLabel() in page.tsx exactly.
function formatCreatedLabel(v) {
  if (!v) return "-";
  const now = new Date();
  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = v.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isSameDay(v, now)) return `Today, ${time}`;
  if (isSameDay(v, yesterday)) return `Yesterday, ${time}`;
  return `${v.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${time}`;
}

const NEW_JOB_CARD_WINDOW_MS = 60 * 60 * 1000;
function isRecentlyCreated(v) {
  if (!v) return false;
  return Date.now() - v.getTime() < NEW_JOB_CARD_WINDOW_MS;
}

console.log("== 1. Task 1 — created label format ==");
{
  const now = new Date();
  const todayAt155pm = new Date(now);
  todayAt155pm.setHours(13, 55, 0, 0);
  check('Same-day timestamp -> "Today, ..."', formatCreatedLabel(todayAt155pm).startsWith("Today, "));

  const yesterdayAt420pm = new Date(now);
  yesterdayAt420pm.setDate(now.getDate() - 1);
  yesterdayAt420pm.setHours(16, 20, 0, 0);
  check('One-day-old timestamp -> "Yesterday, ..."', formatCreatedLabel(yesterdayAt420pm).startsWith("Yesterday, "));

  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(now.getDate() - 2);
  const label = formatCreatedLabel(twoDaysAgo);
  check('Older timestamp -> full date, not "Today"/"Yesterday"', !label.startsWith("Today,") && !label.startsWith("Yesterday,"));
  check("Older timestamp label includes a comma-separated date and time (e.g. \"Aug 9, 2026, 1:55 PM\")", /\w+ \d{1,2}, \d{4}, /.test(label));

  check("Null/undefined -> \"-\" (no crash)", formatCreatedLabel(null) === "-" && formatCreatedLabel(undefined) === "-");
}

console.log("== 2. Task 2 — NEW badge 60-minute window ==");
{
  const justNow = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
  check("Created 5 minutes ago -> isRecentlyCreated true (NEW badge shows)", isRecentlyCreated(justNow) === true);

  const fiftyNineMinAgo = new Date(Date.now() - 59 * 60 * 1000);
  check("Created 59 minutes ago -> still true", isRecentlyCreated(fiftyNineMinAgo) === true);

  const sixtyOneMinAgo = new Date(Date.now() - 61 * 60 * 1000);
  check("Task 9 step 8 — created 61 minutes ago -> false (NEW badge does not show for old records)", isRecentlyCreated(sixtyOneMinAgo) === false);

  const daysAgo = new Date(Date.now() - 3 * 86_400_000);
  check("Created 3 days ago -> false", isRecentlyCreated(daysAgo) === false);

  check("Null -> false (no crash)", isRecentlyCreated(null) === false);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
