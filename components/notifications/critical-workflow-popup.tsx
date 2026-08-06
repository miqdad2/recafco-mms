"use client";

import { startTransition, useEffect, useRef, useState } from "react";

import { getCriticalWorkflowPopupAction, markNotificationReadAction } from "@/app/actions/notifications";
import { useRealtimeConnection } from "@/components/realtime/realtime-connection-provider";
import { WorkflowSuccessModal } from "@/components/ui/workflow-success-modal";
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

export function CriticalWorkflowPopup() {
  const { subscribe } = useRealtimeConnection();
  const [popup, setPopup] = useState<CriticalPopupPayload | null>(null);
  // Tracks the currently-displayed notification id so a second check
  // (either the initial-mount check or another live SSE event) never
  // replaces or stacks a popup that's already showing (Task 9 — "show one
  // latest critical popup only").
  const activeIdRef = useRef<string | null>(null);

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

  if (!popup) return null;

  return (
    <WorkflowSuccessModal
      title={popup.title}
      description={popup.message}
      iconVariant={popup.iconVariant}
      summaryItems={popup.jobCardNumber ? [{ label: "Job Card", value: popup.jobCardNumber }] : undefined}
      primaryAction={{ kind: "link", label: popup.primaryLabel, href: popup.primaryHref, onClick: markReadAndClose }}
      secondaryActions={
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
