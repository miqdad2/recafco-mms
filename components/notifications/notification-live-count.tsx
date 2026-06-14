"use client";

import { useEffect, useState } from "react";

type Props = {
  userId: string;
  initialCount: number;
};

/**
 * Live notification badge count.
 *
 * Rendered by the server with `initialCount` so the badge appears immediately
 * on page load (no flash). After hydration, connects to /api/notifications/stream
 * (SSE) and updates the count in real-time when the server pushes an
 * `unread_count` event.
 *
 * Falls back to `initialCount` if EventSource is unavailable or the connection
 * fails — the parent polling hook provides the safety net in that case.
 */
export function NotificationLiveCount({ userId, initialCount }: Props) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    if (!userId) return;

    const es = new EventSource("/api/notifications/stream");

    es.addEventListener("unread_count", (event) => {
      try {
        const me = event as MessageEvent<string>;
        const data = JSON.parse(me.data) as { count: number };
        if (typeof data.count === "number") {
          setCount(data.count);
        }
      } catch {
        // Ignore malformed events
      }
    });

    // EventSource auto-reconnects on error — do not close on onerror.
    // The fallback polling in useNotifications handles extended outages.

    return () => {
      es.close();
    };
  }, [userId]);

  if (!count) return null;

  return (
    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ED1C24] px-1 text-[10px] font-black text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
