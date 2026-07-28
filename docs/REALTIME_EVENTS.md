# Realtime Events

## Overview

`realtime_events` is an append-only PostgreSQL table that records every
business event worth broadcasting to connected clients.

**This is implemented and live**, not a future phase: `/api/notifications/stream`
(a Server-Sent Events endpoint, also used by the notification bell) polls this
table every 15 seconds per connected user and forwards new rows as a
lightweight `realtime` SSE event (`{ event_type, entity_type, entity_id }`,
no full record, no cost/price fields). Individual pages consume this via
`<RealtimeRefresh watch={[...]} />` (`components/realtime/realtime-refresh.tsx`),
which matches incoming `event_type` values against a prefix list and calls
`router.refresh()` when one matches — debounced, and skipped while the user is
typing, a modal is open, or the tab is hidden (`lib/realtime/refresh-guards.ts`).
Every page using `<RealtimeRefresh />` also keeps its existing `<AutoRefresh />`
poll (typically 15–20s) running as a fallback, so a missed or delayed SSE event
is never permanently lost. No separate WebSocket/Socket.IO server exists or is
planned — this SSE + poll-fallback design is the production real-time system.

**One SSE connection per browser tab.** `RealtimeConnectionProvider`
(`components/realtime/realtime-connection-provider.tsx`, mounted once in
`components/layout/app-layout.tsx`) opens the single `EventSource` for the
whole tab and re-broadcasts each event to any number of in-tab subscribers.
The notification badge (`NotificationLiveCount`), the corner toast
(`NotificationToastCenter`), and every page's `<RealtimeRefresh />` all
subscribe to this shared connection via `useRealtimeConnection()` instead of
each opening its own — previously up to 3 connections per tab, which could
exhaust the browser's ~6-connections-per-origin cap under HTTP/1.1 once 2+
tabs were open and stall page navigation (found and fixed in the
SSEConnectionConsolidation-01 phase).

---

## Table structure

```sql
realtime_events (
  id                 uuid        primary key,
  event_type         text        not null,       -- e.g. "work_order.created"
  entity_type        text        not null,       -- e.g. "work_order", "profile"
  entity_id          uuid,                       -- ID of the primary entity
  actor_profile_id   uuid,                       -- profile ID of the acting user
  target_profile_id  uuid,                       -- direct recipient (optional)
  department_id      uuid,                       -- department scope (optional)
  scope              text,                       -- free-form scope tag (optional)
  payload            jsonb       default '{}',   -- safe, non-sensitive fields
  created_at         timestamptz default now()
)
```

No foreign keys are declared.  The table must never block inserts due to
cascade deletes on the referenced entities.

---

## Event types

Legacy `work_order.*` values are kept for compatibility (some are still
actively emitted by `app/actions/maintenance.ts`) alongside the newer,
user-facing `job_card.*` vocabulary — pages watch both prefixes together, so
nothing needed to change at existing call sites when `job_card.*` was added.

| Constant                         | Value                       | Triggered by              |
|----------------------------------|-----------------------------|---------------------------|
| `REALTIME_EVENTS.WORK_ORDER_CREATED`   | `work_order.created`  | New Job Card saved (legacy name) |
| `REALTIME_EVENTS.WORK_ORDER_SAVED`     | `work_order.saved`    | Existing Job Card edited (legacy name) |
| `REALTIME_EVENTS.JOB_CARD_CREATED`     | `job_card.created`    | New Job Card created |
| `REALTIME_EVENTS.JOB_CARD_SUBMITTED`   | `job_card.submitted`  | Job Card submitted for review |
| `REALTIME_EVENTS.JOB_CARD_REVIEWED`    | `job_card.reviewed`   | Job Card reviewed |
| `REALTIME_EVENTS.JOB_CARD_CORRECTION_REQUESTED` | `job_card.correction_requested` | Supervisor/Manager requests a correction |
| `REALTIME_EVENTS.JOB_CARD_CORRECTION_RESPONDED` | `job_card.correction_responded` | Data Entry resubmits after a correction |
| `REALTIME_EVENTS.JOB_CARD_APPROVED`    | `job_card.approved`   | Job Card approved and opened |
| `REALTIME_EVENTS.JOB_CARD_ASSIGNED`    | `job_card.assigned`   | Technician assigned |
| `REALTIME_EVENTS.JOB_CARD_IN_PROGRESS` | `job_card.in_progress`| Work started |
| `REALTIME_EVENTS.JOB_CARD_CLOSED`      | `job_card.closed`     | Job Card closed |
| `REALTIME_EVENTS.JOB_CARD_UPDATED`     | `job_card.updated`    | Any other Job Card-affecting change (materials added, etc.) |
| `REALTIME_EVENTS.MATERIALS_REQUEST_CREATED`  | `materials_request.created`  | New Materials Request |
| `REALTIME_EVENTS.MATERIALS_REQUEST_APPROVED` | `materials_request.approved` | Materials Request approved |
| `REALTIME_EVENTS.MATERIALS_REQUEST_SENT`     | `materials_request.sent`     | Materials fully received against a request (legacy "sent" verb, kept for compatibility) |
| `REALTIME_EVENTS.MATERIALS_REQUEST_UPDATED`  | `materials_request.updated`  | Materials Request partially updated |
| `REALTIME_EVENTS.MATERIAL_LEDGER_UPDATED`    | `material_ledger.updated`    | Offline Inventory Control ledger changed via a Materials Request receive |
| `REALTIME_EVENTS.OFFLINE_INVENTORY_OPENING_STOCK_ADDED` | `offline_inventory.opening_stock_added` | Add Opening Stock |
| `REALTIME_EVENTS.OFFLINE_INVENTORY_IMPORTED`            | `offline_inventory.imported`            | Import Opening Stock (Excel), one event per batch |
| `REALTIME_EVENTS.OFFLINE_INVENTORY_RECEIVED`            | `offline_inventory.received`            | Add Received Material |
| `REALTIME_EVENTS.OFFLINE_INVENTORY_USED`                | `offline_inventory.used`                | Record Used Material |
| `REALTIME_EVENTS.USER_CREATED`         | `user.created`        | New user account created  |
| `REALTIME_EVENTS.USER_UPDATED`         | `user.updated`        | User profile updated      |
| `REALTIME_EVENTS.BACKUP_UPDATED`       | `backup.updated`      | Backup job status changed |
| `REALTIME_EVENTS.NOTIFICATION_UPDATED` | `notification.updated`| Notification read/archived (defined, not currently emitted — the notification bell/toast reads the `notifications` table directly instead, see below) |

Notifications (bell badge + corner toast) do **not** go through
`realtime_events` at all — `/api/notifications/stream` polls the
`notifications` table directly every 15s and pushes `unread_count` and
`notification` SSE events independent of this table. `NOTIFICATION_CREATED`/
`NOTIFICATION_UPDATED` above are defined for completeness but have no active
emitter; nothing currently depends on them.

---

## Using `emitRealtimeEvent`

```typescript
import { emitRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";

// Inside a server action, after the primary DB write:
await emitRealtimeEvent({
  eventType:       REALTIME_EVENTS.WORK_ORDER_CREATED,
  entityType:      "work_order",
  entityId:        workOrderId,
  actorProfileId:  context.userId,
  departmentId:    departmentId ?? null,
  payload: {
    work_order_number: "REC/MD/MECH/JOB/0042",
    maintenance_type:  "Breakdown",
    priority:          "High",
  },
});
```

`emitRealtimeEvent` never throws.  A failure is written to `system_error_logs`
(severity `warning`) so it shows up in System Health without disrupting the
calling workflow.

---

## Payload rules

The `payload` column must never contain:

- Passwords, tokens, or secrets
- Financial figures: costs, prices, amounts, totals, rates, budgets
- PII beyond what is already in linked entity tables

`emitRealtimeEvent` enforces this with a blocklist that strips these keys
before insert.  Do not add workarounds to bypass the sanitizer.

---

## Event naming rules

```
<entity>.<verb>
```

- Entity: singular lowercase noun matching `entity_type` (`work_order`, `user`, `part`, etc.)
- Verb: past tense action (`created`, `approved`, `assigned`, `completed`, etc.)
- Use `.` as the separator.  No other separators.
- New event types must be added to the `REALTIME_EVENTS` constant in
  `lib/realtime/events.ts` before use.

---

## Verify events are being recorded

```sql
-- Most recent 20 events
select id, event_type, entity_type, entity_id, actor_profile_id, created_at
from public.realtime_events
order by created_at desc
limit 20;

-- Events for a specific work order
select * from public.realtime_events
where entity_type = 'work_order'
  and entity_id = '<uuid>'
order by created_at desc;

-- Event counts by type (last 24 hours)
select event_type, count(*) as cnt
from public.realtime_events
where created_at > now() - interval '24 hours'
group by event_type
order by cnt desc;
```

---

## Page subscriptions

Every server-rendered page that should reflect other users' changes without a
manual reload pairs `<AutoRefresh intervalMs={...} />` (poll fallback) with
`<RealtimeRefresh watch={[...]} />` (instant trigger on a matching event
prefix). Recommended watch lists by page type:

- Dashboards: `job_card.`, `work_order.`, `materials_request.`, `offline_inventory.`, `material_ledger.`, `notification.`
- Job Cards list/detail: `job_card.`, `work_order.`, `materials_request.`
- Materials Requests list/detail: `materials_request.`, `job_card.`, `work_order.`, `offline_inventory.`, `material_ledger.`
- Offline Inventory Control / Movement History: `offline_inventory.`, `material_ledger.`, `materials_request.`, `job_card.`

Should a heavier real-time layer (WebSockets/Socket.IO) ever become
necessary, the `scope`, `target_profile_id`, and `department_id` columns
already provide the routing hints a broadcast server would need — but as of
this writing, SSE + poll fallback fully satisfies the real-time requirement
at this system's scale (see `components/realtime/realtime-refresh.tsx` and
`app/api/notifications/stream/route.ts`).
