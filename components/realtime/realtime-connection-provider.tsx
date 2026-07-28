"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

// SSE Connection Consolidation Unit: previously three separate components
// each opened their own EventSource to /api/notifications/stream —
// NotificationLiveCount (badge), NotificationToastCenter (corner toast), and
// every page-level <RealtimeRefresh /> (via useRealtimeEvents). All three are
// mounted together on every dashboard page (the first two globally, in
// AppLayout), so a single open tab could carry up to 3 concurrent SSE
// connections to the same endpoint — enough, combined across 2-3 open tabs,
// to exhaust the browser's ~6-connections-per-origin cap under HTTP/1.1 and
// stall unrelated page navigations (confirmed live during the
// RealtimeCorrectionResubmitBugFix-01 phase).
//
// This provider opens exactly ONE EventSource per mounted instance (i.e. one
// per browser tab, since it's mounted once in AppLayout) and re-broadcasts
// each named SSE event to any number of in-tab subscribers via a private
// EventTarget — no change to the server, the SSE endpoint, or the event
// payloads themselves, only how many physical connections the browser opens.

type Listener<T> = (data: T) => void;

type RealtimeConnectionContextValue = {
  subscribe: <T = unknown>(eventName: string, listener: Listener<T>) => () => void;
};

const RealtimeConnectionContext = createContext<RealtimeConnectionContextValue | null>(null);

export function RealtimeConnectionProvider({
  userId,
  children,
}: {
  userId: string | null | undefined;
  children: React.ReactNode;
}) {
  // A private, stable EventTarget used purely as an in-memory pub-sub bus —
  // never touches the DOM, just reuses the browser's built-in event dispatch.
  const busRef = useRef<EventTarget>(new EventTarget());

  useEffect(() => {
    if (!userId) return;

    const es = new EventSource("/api/notifications/stream");

    function relay(eventName: string) {
      return (event: MessageEvent<string>) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return; // Ignore malformed events, same as every consumer did individually before.
        }
        busRef.current.dispatchEvent(new CustomEvent(eventName, { detail: parsed }));
      };
    }

    // Same three event names the three original consumers listened for.
    const onUnreadCount = relay("unread_count");
    const onNotification = relay("notification");
    const onRealtime = relay("realtime");

    es.addEventListener("unread_count", onUnreadCount as EventListener);
    es.addEventListener("notification", onNotification as EventListener);
    es.addEventListener("realtime", onRealtime as EventListener);
    // EventSource auto-reconnects on transient errors — every original
    // consumer deliberately never closed on "error"; preserved here too.

    return () => {
      es.removeEventListener("unread_count", onUnreadCount as EventListener);
      es.removeEventListener("notification", onNotification as EventListener);
      es.removeEventListener("realtime", onRealtime as EventListener);
      es.close();
    };
  }, [userId]);

  const subscribe = useCallback(<T,>(eventName: string, listener: Listener<T>) => {
    const handler = (event: Event) => {
      listener((event as CustomEvent<T>).detail);
    };
    busRef.current.addEventListener(eventName, handler);
    return () => busRef.current.removeEventListener(eventName, handler);
  }, []);

  return (
    <RealtimeConnectionContext.Provider value={{ subscribe }}>
      {children}
    </RealtimeConnectionContext.Provider>
  );
}

// Consumers outside a provider (e.g. unauthenticated pages) get a safe no-op
// subscribe instead of a thrown error — matches the previous behavior where
// each component's own effect simply did nothing when `userId` was falsy.
const noopSubscribe: RealtimeConnectionContextValue["subscribe"] = <T,>(
  _eventName: string,
  _listener: Listener<T>
) => {
  return () => {};
};

export function useRealtimeConnection(): RealtimeConnectionContextValue {
  const ctx = useContext(RealtimeConnectionContext);
  return ctx ?? { subscribe: noopSubscribe };
}
