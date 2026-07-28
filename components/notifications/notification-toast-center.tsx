"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";

import { getClientNotificationsAction, markNotificationReadAction } from "@/app/actions/notifications";
import { isSafeToRefresh } from "@/lib/realtime/refresh-guards";
import { useRealtimeConnection } from "@/components/realtime/realtime-connection-provider";
import type { NotificationListItem } from "@/lib/notifications/types";

// Enterprise Real-Time Notifications Unit — Task 4/5/12. A lightweight,
// corner-anchored, non-blocking popup for new notifications, fed by the
// existing SSE endpoint's "notification" event (no new route needed — Task
// 3/5's "reuse existing before building new infra"). Deliberately NOT the
// same component as <ActionToast /> — that one is a full-screen centered
// modal-style overlay for this page's own action feedback, which Task 4
// explicitly says a real-time popup must not be ("should not block the
// whole screen").
//
// SSE Connection Consolidation Unit: subscribes to the shared
// RealtimeConnectionProvider (one EventSource per tab) instead of opening
// its own — previously this and NotificationLiveCount each opened a
// separate connection to the same endpoint.

const AUTO_DISMISS_MS = 8000;
const DEBOUNCE_MS = 800;

type ToastEntry =
  | { kind: "single"; id: number; notification: NotificationListItem; visible: boolean }
  | { kind: "grouped"; id: number; count: number; visible: boolean };

let nextToastId = 1;

export function NotificationToastCenter({ userId: _userId }: { userId: string | null | undefined }) {
  const router = useRouter();
  const { subscribe } = useRealtimeConnection();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const shownIds = useRef<Set<string>>(new Set());
  const pendingIds = useRef<Set<string>>(new Set());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefresh = useRef(false);

  function dismiss(id: number) {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: false } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 220);
  }

  useEffect(() => {
    async function flush() {
      const ids = [...pendingIds.current];
      pendingIds.current.clear();
      if (ids.length === 0) return;

      const { notifications } = await getClientNotificationsAction(20);
      const fresh = notifications.filter(
        (n) => ids.includes(n.id) && !shownIds.current.has(n.id) && !n.read_at
      );
      if (fresh.length === 0) return;
      fresh.forEach((n) => shownIds.current.add(n.id));

      const id = nextToastId++;
      if (fresh.length === 1) {
        setToasts((prev) => [...prev, { kind: "single", id, notification: fresh[0], visible: false }]);
      } else {
        setToasts((prev) => [...prev, { kind: "grouped", id, count: fresh.length, visible: false }]);
      }
      setTimeout(() => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: true } : t)));
      }, 16);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);

      // Task 12: also freshen this page's own server-rendered data (e.g. the
      // bell dropdown's snapshot list) — debounced with the toast itself,
      // and skipped while the user is typing or a modal is open so an
      // in-progress form never loses input.
      if (isSafeToRefresh()) {
        pendingRefresh.current = false;
        router.refresh();
      } else {
        pendingRefresh.current = true;
      }
    }

    function scheduleFlush() {
      if (debounceTimer.current) return;
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        void flush();
      }, DEBOUNCE_MS);
    }

    function onNotification(data: { id?: string }) {
      if (data.id) pendingIds.current.add(data.id);
      scheduleFlush();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && pendingRefresh.current && isSafeToRefresh()) {
        pendingRefresh.current = false;
        router.refresh();
      }
    }

    const unsubscribe = subscribe<{ id?: string }>("notification", onNotification);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [subscribe, router]);

  function openNotification(n: NotificationListItem) {
    startTransition(() => {
      const fd = new FormData();
      fd.set("notification_id", n.id);
      void markNotificationReadAction(fd);
    });
  }

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[calc(100vw-2rem)] max-w-[380px] flex-col gap-2"
      aria-label="Real-time notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          style={{
            opacity: toast.visible ? 1 : 0,
            transform: toast.visible ? "translateY(0)" : "translateY(-12px)",
            transition: "opacity 0.25s ease, transform 0.25s ease"
          }}
          className="pointer-events-auto overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-lg"
        >
          <div className="flex items-start gap-3 p-4">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50">
              <Bell className="h-4 w-4 text-[#ED1C24]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              {toast.kind === "single" ? (
                <>
                  <p className="truncate text-sm font-bold text-[#111827]">{toast.notification.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-[#4B5563]">{toast.notification.message}</p>
                  {toast.notification.action_url ? (
                    <a
                      href={toast.notification.action_url}
                      onClick={() => openNotification(toast.notification)}
                      className="mt-2 inline-block text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]"
                    >
                      {toast.notification.action_label ?? "Open"}
                    </a>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-[#111827]">{toast.count} new updates</p>
                  <a
                    href="/notifications"
                    className="mt-2 inline-block text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]"
                  >
                    View all
                  </a>
                </>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-[#9CA3AF] transition-colors hover:bg-[#F3F5F8] hover:text-[#4B5563]"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
