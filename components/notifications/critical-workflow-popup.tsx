"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getCriticalWorkflowPopupAction, markNotificationReadAction } from "@/app/actions/notifications";
import { useRealtimeConnection } from "@/components/realtime/realtime-connection-provider";
import { WorkflowSuccessModal, type WorkflowSuccessAction } from "@/components/ui/workflow-success-modal";
import { ClosureReviewModal } from "@/components/dashboard/closure-review-modal";
import { JobCardSummaryModal } from "@/components/dashboard/job-card-summary-modal";
import type { CriticalPopupPayload } from "@/lib/notifications/critical-popup";

// Role-to-Role Critical Workflow Popup Unit 9G, Task 6/8/9/10.
//
// A centered modal, reusing the standardized WorkflowSuccessModal shell
// (Task 6 — "same visual language"), shown only for the small allowlist of
// role-to-role Job Card events lib/notifications/critical-popup.ts defines
// (e.g. Manager closes a Job Card -> Data Entry sees this; Data Entry
// requests closure -> Manager sees this). Every other notification keeps
// using the existing bell/dropdown/Notification Center and the existing
// corner toast (NotificationToastCenter, untouched) — this component adds
// one more, stronger surface on top for a short, specific list of events,
// it does not replace anything (Task 1).
//
// Mounted once, unconditionally, in app-layout.tsx next to
// NotificationToastCenter — for any role other than Data Entry/Manager,
// getCriticalWorkflowPopupAction always resolves to null (checked
// server-side in getCriticalWorkflowPopup), so this is a no-op for them.
//
// Critical Workflow Popup Review Modal Unit 10G.7, Task 1/2/3/4/5/6: for
// popups whose rule declares a `reviewMode` (currently the two Manager
// rules — Closure Approval Needed, New Active Job Card), the primary button
// no longer navigates away. It swaps this popup for ClosureReviewModal or
// JobCardSummaryModal in place (reusing both wholesale — no review/approval
// logic duplicated here), and only marks the source notification read once
// that modal's own data fetch actually succeeds (onLoaded), never on click
// alone and never if the load fails. Every other rule (every existing Data
// Entry rule) has no reviewMode and keeps the exact prior plain-link
// behavior untouched.

const DISMISSED_KEY = "recafco_dismissed_critical_popups";

// Task 10 — dismissed ids are kept in sessionStorage only (not localStorage,
// not the database): scoped to "this browser session," cleared when the tab
// closes, and deliberately does NOT call markNotificationReadAction — a
// dismissed popup can still be read later from the bell/Notification Center
// like any other unread notification, exactly as the task specifies.
function getDismissedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function addDismissedId(id: string) {
  if (typeof window === "undefined") return;
  try {
    const ids = getDismissedIds();
    ids.add(id);
    window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage unavailable (private browsing, storage quota, etc.) —
    // fail open; worst case is the same popup can reappear after a refresh,
    // never worse than that, and never a crash.
  }
}

// Unit 10G.7 — which review modal (if any) is currently swapped in for the
// critical popup, and which notification it belongs to (so the read-mark
// and dismiss-on-failure logic below know which id to act on).
type ReviewSession = { notificationId: string; workOrderId: string; mode: "closure_review" | "job_card_summary" };

export function CriticalWorkflowPopup() {
  const router = useRouter();
  const { subscribe } = useRealtimeConnection();
  const [popup, setPopup] = useState<CriticalPopupPayload | null>(null);
  const [reviewing, setReviewing] = useState<ReviewSession | null>(null);
  // Tracks the currently-displayed notification id so a second check
  // (either the initial-mount check or another live SSE event) never
  // replaces or stacks a popup that's already showing (Task 9 — "show one
  // latest critical popup only"). Stays set for the whole reviewing session
  // too, so no second popup can appear while a review modal is open.
  const activeIdRef = useRef<string | null>(null);
  // Task 6 — whether the CURRENT review session's modal has successfully
  // loaded yet; read on close to decide whether to dismiss (session-scoped)
  // a review that never actually opened.
  const reviewLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tryShow(notificationId?: string) {
      if (activeIdRef.current) return;
      const result = await getCriticalWorkflowPopupAction(notificationId);
      if (cancelled || !result) return;
      if (getDismissedIds().has(result.id)) return;
      activeIdRef.current = result.id;
      setPopup(result);
    }

    // Task 9 fallback path — "latest critical unread notification from the
    // last 5 minutes." Covers logging in / loading the dashboard shortly
    // after the triggering action happened, when this tab wasn't open to
    // catch the live SSE event.
    void tryShow();

    // Task 9 primary path — "new critical notifications received after
    // session starts." Reuses the one shared SSE connection every other
    // realtime feature on this layout already uses (no new EventSource,
    // Task 8) — the "notification" event is a bare { id } trigger, so a
    // server-action round trip resolves and filters the real row.
    const unsubscribe = subscribe<{ id?: string }>("notification", (data) => {
      if (data.id) void tryShow(data.id);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [subscribe]);

  function close() {
    if (popup) addDismissedId(popup.id);
    activeIdRef.current = null;
    setPopup(null);
  }

  // Task 10 — primary action click marks the notification read (reusing the
  // existing markNotificationReadAction, the same one the toast center and
  // Notification Center already use) and then lets the <Link> navigate.
  // Only reached for rules with no reviewMode (every existing Data Entry
  // rule) — unchanged from before this unit.
  function markReadAndClose() {
    if (!popup) return;
    startTransition(() => {
      const fd = new FormData();
      fd.set("notification_id", popup.id);
      void markNotificationReadAction(fd);
    });
    activeIdRef.current = null;
    setPopup(null);
  }

  // Task 1/2/4 — primary button for a reviewMode popup: swap the critical
  // popup for the matching review modal, in place. activeIdRef stays set
  // (already popup.id) so no second popup can appear underneath it.
  function openReview() {
    if (!popup || !popup.reviewMode || !popup.workOrderId) return;
    reviewLoadedRef.current = false;
    setReviewing({ notificationId: popup.id, workOrderId: popup.workOrderId, mode: popup.reviewMode });
    setPopup(null);
  }

  // Task 6 — passed as the review modal's onLoaded: fires exactly once,
  // only once the modal's own fetch has actually succeeded.
  function markReviewLoaded() {
    reviewLoadedRef.current = true;
    if (!reviewing) return;
    startTransition(() => {
      const fd = new FormData();
      fd.set("notification_id", reviewing.notificationId);
      void markNotificationReadAction(fd);
    });
  }

  // Task 6 — closing the review modal (X / Back / Dismiss inside it) without
  // approving anything. If it never successfully loaded, treat it the same
  // as the original popup's own Dismiss (session-scoped, still unread, can
  // resurface from the bell/Notification Center) rather than silently
  // losing it. If it DID load, it's already marked read — nothing more to do.
  function closeReview() {
    if (reviewing && !reviewLoadedRef.current) addDismissedId(reviewing.notificationId);
    activeIdRef.current = null;
    setReviewing(null);
  }

  // Task 3 — after an in-review approval: close the review modal and
  // refresh the dashboard (KPI/closure-requests count included). The
  // "Job Card Closed" success toast is already dispatched inside
  // ClosureReviewModal itself — not duplicated here.
  function approveAndCloseReview() {
    activeIdRef.current = null;
    setReviewing(null);
    router.refresh();
  }

  if (reviewing) {
    if (reviewing.mode === "closure_review") {
      return (
        <ClosureReviewModal
          workOrderId={reviewing.workOrderId}
          onClose={closeReview}
          onApproved={approveAndCloseReview}
          onLoaded={markReviewLoaded}
        />
      );
    }
    return <JobCardSummaryModal workOrderId={reviewing.workOrderId} onClose={closeReview} onLoaded={markReviewLoaded} />;
  }

  if (!popup) return null;

  // Task 1 — reviewMode popups get a plain button (opens the modal, no
  // navigation); every other popup keeps the original Link-based primary
  // action untouched.
  const primaryAction: WorkflowSuccessAction =
    popup.reviewMode && popup.workOrderId
      ? { kind: "button", label: popup.primaryLabel, onClick: openReview }
      : { kind: "link", label: popup.primaryLabel, href: popup.primaryHref, onClick: markReadAndClose };

  return (
    <WorkflowSuccessModal
      title={popup.title}
      description={popup.message}
      iconVariant={popup.iconVariant}
      summaryItems={popup.jobCardNumber ? [{ label: "Job Card", value: popup.jobCardNumber }] : undefined}
      primaryAction={primaryAction}
      secondaryActions={
        // Task 5 — "Open Full Job Card" (reviewMode popups) or whatever
        // static secondary the rule defines (e.g. Data Entry's "Open Daily
        // Activity") — either way, a real navigation, dismiss-only on click
        // (unchanged from before this unit).
        popup.secondaryLabel && popup.secondaryHref
          ? [{ kind: "link", label: popup.secondaryLabel, href: popup.secondaryHref, onClick: close }]
          : undefined
      }
      closeAction={close}
      closeLabel="Dismiss"
      headingId="critical-workflow-popup-heading"
    />
  );
}
