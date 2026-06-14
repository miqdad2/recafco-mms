# Realtime Events

## Overview

`realtime_events` is an append-only PostgreSQL table that records every
business event worth broadcasting to connected clients.  Phase 1 only inserts
rows.  Phase 2 will add a Socket.IO server that tails the table and pushes rows
to subscribed clients.

No application action code needs to change in Phase 2.

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

| Constant                         | Value                       | Triggered by              |
|----------------------------------|-----------------------------|---------------------------|
| `REALTIME_EVENTS.WORK_ORDER_CREATED`   | `work_order.created`  | New work order saved      |
| `REALTIME_EVENTS.WORK_ORDER_SAVED`     | `work_order.saved`    | Existing work order edited|
| `REALTIME_EVENTS.WORK_ORDER_SUBMITTED` | `work_order.submitted`| WO submitted for approval |
| `REALTIME_EVENTS.WORK_ORDER_APPROVED`  | `work_order.approved` | WO approved               |
| `REALTIME_EVENTS.WORK_ORDER_REJECTED`  | `work_order.rejected` | WO rejected               |
| `REALTIME_EVENTS.WORK_ORDER_ASSIGNED`  | `work_order.assigned` | Technician assigned       |
| `REALTIME_EVENTS.WORK_ORDER_COMPLETED` | `work_order.completed`| WO marked completed       |
| `REALTIME_EVENTS.USER_CREATED`         | `user.created`        | New user account created  |
| `REALTIME_EVENTS.USER_UPDATED`         | `user.updated`        | User profile updated      |
| `REALTIME_EVENTS.BACKUP_UPDATED`       | `backup.updated`      | Backup job status changed |
| `REALTIME_EVENTS.NOTIFICATION_UPDATED` | `notification.updated`| Notification read/archived|

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

## Phase 2 — Socket.IO broadcast integration

When Socket.IO is added:

1. A Node.js server process subscribes to a PostgreSQL `LISTEN` channel or
   polls `realtime_events` for new rows.
2. On each new row it maps `event_type` → Socket.IO room name and emits.
3. The client subscribes to rooms matching its profile ID and role.
4. No changes are required in any `app/actions/*` file.

The `scope`, `target_profile_id`, and `department_id` columns provide the
necessary routing hints for the broadcast layer.
