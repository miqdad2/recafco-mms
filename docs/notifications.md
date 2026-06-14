# Notification System

The RECAFCO notification system is centralized around event keys. Workflow actions call `notifyByEvent()` and the service resolves recipients, renders templates, checks preferences, writes in-app notifications, and logs delivery attempts.

## Tables

- `notification_events`: event catalog with category, priority, criticality, enabled state, and future channel flags.
- `notification_templates`: channel templates. In-app is active now; email, WhatsApp, SMS, and push are future foundations.
- `notifications`: existing table extended safely with recipient, category, priority, action, metadata, read, archive, and creator fields. Legacy `recipient_id`, `notification_type`, and `is_read` remain supported.
- `notification_preferences`: per-user in-app preferences for noncritical events.
- `notification_delivery_logs`: delivery attempt audit for sent, failed, disabled, skipped, and future provider results.

## Core Service Files

- `lib/notifications/events.ts`: code fallback event definitions.
- `lib/notifications/templates.ts`: template rendering with `{token}` replacement.
- `lib/notifications/service.ts`: notification send/read/archive APIs and event orchestration.
- `lib/notifications/recipients.ts`: centralized recipient resolution rules.
- `lib/notifications/preferences.ts`: user preference reads/writes and critical-event handling.
- `lib/notifications/delivery.ts`: safe delivery log writes.
- `lib/notifications/types.ts`: shared notification types.

## Categories

- Work Orders
- Approvals
- Technician Jobs
- Parts Requests
- Store / Inventory
- Purchase
- Finance
- CEO / Management
- Assets
- Reports
- System

## Priorities

- `low`
- `normal`
- `high`
- `urgent`

## Recipient Rules

- Work order submitted: Maintenance Manager, optionally Super Admin when passed by caller.
- Work order approved: Maintenance Supervisor and work order creator when supplied.
- Technician assigned: assigned technician and Maintenance Manager.
- Technician updates: Maintenance Supervisor receives started-job, note, labor, and photo upload events.
- Technician completed job: Maintenance Supervisor and Maintenance Manager.
- Parts request submitted: Maintenance Manager.
- Parts request approved: Store Keeper and requester when supplied.
- Store marks unavailable: Purchase Officer, Maintenance Manager, and requester when supplied.
- Purchase needs finance approval: Finance Manager.
- Purchase exceeds CEO threshold: CEO / Management.
- Low stock: Store Keeper, Maintenance Manager, and Purchase Officer.

Recipient logic belongs in `lib/notifications/recipients.ts`; workflow files should not duplicate role lookups.

## UI Routes

- `/notifications`: current user's Notification Center with read/archive controls and filters.
- `/profile/notifications`: user preference foundation for noncritical in-app events.
- `/admin/notification-settings`: Super Admin / IT Admin event, template, delivery log, and recent notification control surface.

## Header Bell

`components/notifications/notification-bell.tsx` is a server component that fetches the
initial unread count at request time and renders the bell with the dropdown preview.

`components/notifications/notification-live-count.tsx` is a client component that the bell
embeds for the badge. It receives the server-rendered `initialCount` so the badge appears
immediately in the HTML, then connects to SSE after hydration and updates the count in
real-time without a page reload.

---

## Real-Time Delivery: Server-Sent Events (Phase 2B)

### SSE Endpoint

**`GET /api/notifications/stream`**

Long-lived HTTP connection that streams events to the authenticated browser tab.

- Requires a valid session cookie. Returns `401` if unauthenticated.
- Scoped strictly to the authenticated user — no other user's notifications are sent.
- Polls PostgreSQL every **15 seconds** per open connection.
- Sends a heartbeat every **25 seconds** (`ping` event) to keep the connection alive
  through proxies and load-balancers that would otherwise drop idle connections.
- Cleans up DB timers on client disconnect (`request.signal abort` and `ReadableStream.cancel`).

### SSE Event Names and Payloads

| Event | Payload | When sent |
|-------|---------|-----------|
| `unread_count` | `{ count: number }` | Immediately on connect; after every 15 s poll |
| `notification` | `{ id, title, category, priority, created_at }` | For each new notification created since the previous poll |
| `ping` | `{ ts: number }` | Every 25 s — heartbeat only, no action needed |

The `notification` event payload is intentionally minimal — it carries just enough for
the client to decide whether to refresh. The client hook calls `refresh()` on receipt,
which fetches the full list via the existing `getClientNotificationsAction` server action.
This avoids embedding sensitive cost or metadata fields directly in the SSE stream.

### Client-Side Integration

**`hooks/use-notifications.ts`** — dual-layer delivery hook:

```
Layer 1 (SSE)
  EventSource → /api/notifications/stream
    unread_count event → setUnreadCount() immediately (no server round-trip)
    notification event → refresh() to load full list
    ping event        → ignored
    error             → auto-reconnect (native EventSource behaviour)

Layer 2 (Polling fallback)
  setInterval every 45 s (default, minimum 10 s)
    refresh() → getClientNotificationsAction(20)
    Acts as primary source if SSE stays down for a full interval
```

Both layers run simultaneously and are intentionally independent. Either can be
removed without breaking the other.

**`components/notifications/notification-live-count.tsx`** — client badge:

Opens its own SSE connection for `unread_count` events. This component is embedded
inside `NotificationBell` (server component) so it does not require the full
`useNotifications` hook in the layout. The badge shows the server-rendered initial
count immediately, then switches to SSE-driven live updates after hydration.

### How to Test

1. Open the app in two browser tabs logged in as the same user (e.g., Maintenance Data Entry).
2. In Tab A, note the notification badge count.
3. In Tab B, perform an action that creates a notification (e.g., submit a work order).
4. In Tab A, the badge should update within **15 seconds** without a page reload.
5. To verify SSE is connected, open DevTools → Network → filter by "stream" —
   you should see `GET /api/notifications/stream` with type `eventsource` and status 200.
6. To verify fallback: in DevTools, block `/api/notifications/stream`. The badge will
   continue updating via polling within 45 seconds.

To test Super Admin security event notifications:
- Security events (account unlock, session revoke) use `security.account_unlocked` and
  `security.sessions_revoked` event keys. They appear in the Super Admin notification
  center within 15 seconds of being written to the `notifications` table.

### DB Query Load

| Scenario | Queries per 15 s |
|----------|-----------------|
| 10 users connected | ~20 (2 per user: count + new rows) |
| 30 users connected | ~60 |
| 50 users connected | ~100 |

Both queries use indexed columns (`recipient_user_id`, `created_at`, `archived_at`).
PostgreSQL handles this load without tuning for an internal system of this size.

### Single-Server Limitation

The SSE stream polls the PostgreSQL database directly. This works correctly for a
**single application server** (the current RECAFCO setup on Windows).

If the application is later scaled to multiple servers (load-balanced), each server
polls the database independently. Notifications created during a request handled by
Server A will appear in Server B's streams within 15 seconds — there is no missed
event, just a short delay relative to the server that handled the write.

For true fan-out across many servers with sub-second latency, a Pub/Sub channel
(Redis or PostgreSQL `LISTEN/NOTIFY`) can be added in front of the SSE endpoint.
The stream format and client code do not need to change — only the server-side polling
logic inside `app/api/notifications/stream/route.ts` would be replaced.

### PostgreSQL LISTEN/NOTIFY (Future Option)

If latency below 15 seconds is required on a multi-server deployment:

```sql
-- On every INSERT to notifications:
NOTIFY notification_created, 'user-profile-uuid-here';
```

```typescript
// In the SSE route, replace the setInterval poll with:
const client = await pool.connect();
await client.query("LISTEN notification_created");
client.on("notification", async (msg) => {
  if (msg.payload === userId) {
    const count = await getUnreadNotificationCount(userId);
    send("unread_count", { count });
    // query for new rows and send notification events
  }
});
```

This requires a persistent PostgreSQL client per SSE connection, which is suitable
for a moderate number of users but needs connection-pool tuning at scale.

---

## Security

- Users read only their own notifications.
- Users update only their own read/archive status.
- Super Admin and IT Admin manage events/templates/logs through `admin.notification_settings.manage`.
- Critical notifications can be forced by `app_settings.force_critical_notifications`.
- The SSE endpoint returns `401` for unauthenticated requests — it does not redirect.
- SSE stream payloads contain no sensitive cost or finance metadata.
  The `notification` event carries only `id`, `title`, `category`, `priority`, `created_at`.
  Full notification data is only fetched server-side via `getClientNotificationsAction`,
  which enforces the user scope on every call.
- Metadata must not include sensitive cost values unless the destination route enforces cost visibility.
- External channels remain disabled until provider, consent, and data-retention rules are approved.

## Future External Channels

The schema is ready for email, WhatsApp, SMS, and push templates and logs, but only in-app delivery is implemented. Future work should add provider-specific workers outside the main workflow transaction so maintenance actions never fail because an external provider is unavailable.
