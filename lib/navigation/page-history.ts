// Page-header Back: the per-tab list of visited in-app pages and where Back
// goes. Pure functions (no browser APIs) — components/layout/page-back-button
// stores the list in sessionStorage and calls these.
//
// Entries are internal paths with their query ("/maintenance/work-orders?status=Closed").
// Same-page changes (filters, tabs, ?new_job_card=1) replace the current
// entry, so Back leaves the page instead of stepping through filter changes;
// arriving at the previous page (Back, browser back, or a link) pops, so
// A → B → A never ping-pongs.

export const MAX_PAGE_HISTORY = 50;

/** Only same-site paths: "/x", never "//host", "/\host", "http:…" or "javascript:…". */
export function isInternalPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

export function pathOf(entry: string) {
  return entry.split(/[?#]/)[0];
}

/** The list after visiting `current` (path + query). */
export function recordPageVisit(entries: string[], current: string): string[] {
  if (!isInternalPath(current)) return entries;
  const next = entries.filter(isInternalPath);
  const path = pathOf(current);
  const top = next[next.length - 1];
  const previous = next[next.length - 2];
  if (top !== undefined && pathOf(top) === path) {
    next[next.length - 1] = current;
  } else if (previous !== undefined && pathOf(previous) === path) {
    next.pop();
    next[next.length - 1] = current;
  } else {
    next.push(current);
  }
  return next.slice(-MAX_PAGE_HISTORY);
}

/** Where Back goes from `pathname`: the previous in-app page, else `fallbackHref`. */
export function backTarget(entries: string[], pathname: string, fallbackHref: string): string {
  const valid = entries.filter(isInternalPath);
  const top = valid[valid.length - 1];
  // Normally the list ends on this page; if it does not (not yet recorded),
  // its last entry is the page to return to.
  const target = top !== undefined && pathOf(top) === pathname ? valid[valid.length - 2] : top;
  return target !== undefined && pathOf(target) !== pathname ? target : fallbackHref;
}
