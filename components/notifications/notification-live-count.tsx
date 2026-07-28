"use client";

import { useEffect, useState } from "react";

import { useRealtimeConnection } from "@/components/realtime/realtime-connection-provider";

type Props = {
  userId: string;
  initialCount: number;
};

/**
 * Live notification badge count.
 *
 * Rendered by the server with `initialCount` so the badge appears immediately
 * on page load (no flash). After hydration, subscribes to the shared
 * `RealtimeConnectionProvider` (SSE Connection Consolidation Unit — one
 * EventSource per tab, shared with the toast center and RealtimeRefresh
 * rather than this component opening its own) and updates the count in
 * real-time when the server pushes an `unread_count` event.
 *
 * Falls back to `initialCount` if the shared connection is unavailable — the
 * parent polling hook provides the safety net in that case.
 */
export function NotificationLiveCount({ initialCount }: Props) {
  const [count, setCount] = useState(initialCount);
  const { subscribe } = useRealtimeConnection();

  useEffect(() => {
    return subscribe<{ count: number }>("unread_count", (data) => {
      if (typeof data.count === "number") {
        setCount(data.count);
      }
    });
  }, [subscribe]);

  if (!count) return null;

  return (
    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ED1C24] px-1 text-[10px] font-black text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
