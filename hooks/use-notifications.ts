"use client";

import { useCallback, useEffect, useState } from "react";

import {
  archiveNotificationAction,
  getClientNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction
} from "@/app/actions/notifications";

type ClientNotification = {
  id: string;
  title: string;
  message: string;
  category: string;
  priority: string;
  action_url: string | null;
  action_label: string | null;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
};

/**
 * Real-time notification hook.
 *
 * Delivery strategy (two layers, both active simultaneously):
 *
 * 1. SSE stream (/api/notifications/stream)
 *    - `unread_count` event → updates badge immediately, no DB round-trip.
 *    - `notification` event → triggers a full list refresh so new items appear.
 *    - `ping` event → ignored (heartbeat from server, keeps connection alive).
 *    - Auto-reconnects on error (native EventSource behaviour).
 *
 * 2. Fallback polling (default: every 45 s)
 *    - Runs alongside SSE as a safety net.
 *    - Provides initial data load on mount.
 *    - Takes over automatically if SSE stays down for a full interval.
 *    - Interval enforced to minimum 10 s.
 *
 * The two layers are intentionally independent — removing either one leaves
 * the other working without code changes.
 */
export function useNotifications(userId: string | null | undefined, pollIntervalSeconds = 45) {
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const result = await getClientNotificationsAction(20);
      setNotifications(result.notifications as ClientNotification[]);
      setUnreadCount(result.unreadCount);
    } finally {
      // Always reset loading — even if the action throws.
      setIsLoading(false);
    }
  }, [userId]);

  const markRead = useCallback(async (notificationId: string) => {
    const formData = new FormData();
    formData.set("notification_id", notificationId);
    await markNotificationReadAction(formData);
    await refresh();
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsReadAction();
    await refresh();
  }, [refresh]);

  const archive = useCallback(async (notificationId: string) => {
    const formData = new FormData();
    formData.set("notification_id", notificationId);
    await archiveNotificationAction(formData);
    await refresh();
  }, [refresh]);

  // ── SSE connection ────────────────────────────────────────────────────────
  // Opens a single EventSource per mounted component.
  // Re-opens when userId changes (logout/login in the same tab).
  useEffect(() => {
    if (!userId) return;

    const es = new EventSource("/api/notifications/stream");

    es.addEventListener("unread_count", (event) => {
      try {
        const me = event as MessageEvent<string>;
        const data = JSON.parse(me.data) as { count: number };
        if (typeof data.count === "number") {
          setUnreadCount(data.count);
        }
      } catch {
        // Ignore malformed events
      }
    });

    es.addEventListener("notification", () => {
      // A new notification arrived — refresh the full list so it appears.
      void refresh();
    });

    // Do NOT close on onerror: EventSource auto-reconnects with back-off.
    // The polling effect below continues to run as a safety net.

    return () => {
      es.close();
    };
  }, [userId, refresh]);

  // ── Fallback polling ──────────────────────────────────────────────────────
  // Runs on mount (immediate) and at the configured interval.
  // Acts as the primary data source when SSE is unavailable.
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), Math.max(10, pollIntervalSeconds) * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [pollIntervalSeconds, refresh]);

  return { notifications, unreadCount, isLoading, markRead, markAllRead, archive, refresh };
}
