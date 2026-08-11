// Enterprise Real-Time Update Foundation Unit Task 5: shared "is it safe to
// auto-refresh right now" checks, used by both the existing poll-based
// useAutoRefresh and the new event-triggered useRealtimeEvents — a real-time
// event arriving while someone is mid-keystroke in a form, or with a modal
// open, must never silently blow away unsaved input.
//
// Client-safe only (no "server-only" import) — this runs in the browser.

export function isUserTyping(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (active instanceof HTMLElement && active.isContentEditable) return true;
  return false;
}

// Every modal/panel/quick-view built in this app so far uses
// role="dialog" (confirmed across the Job Card quick-view, Review/Approve/
// Close panels, Assignment form, etc.) — a cheap, reliable signal that the
// user has an open form they might lose if the page refreshes underneath
// them.
export function isModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="dialog"]') !== null;
}

export function isSafeToRefresh(): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState === "hidden") return false;
  if (isUserTyping()) return false;
  if (isModalOpen()) return false;
  return true;
}
