-- Realtime event log table.
--
-- Stores a lightweight append-only record of every business event that should
-- be broadcast to connected clients.  No FKs are declared so the table never
-- blocks inserts when a referenced entity was just deleted.
--
-- Phase 1: only INSERT rows here.  Socket.IO broadcast will be added in Phase 2
-- by reading and clearing rows from this table (or by a dedicated LISTEN/NOTIFY
-- trigger added later).
--
-- All statements are idempotent.

create table if not exists public.realtime_events (
  id                 uuid        primary key default gen_random_uuid(),
  event_type         text        not null,
  entity_type        text        not null,
  entity_id          uuid,
  actor_profile_id   uuid,
  target_profile_id  uuid,
  department_id      uuid,
  scope              text,
  payload            jsonb       not null default '{}',
  created_at         timestamptz not null default now()
);

-- Most reads will be polling for recent events → created_at desc.
create index if not exists idx_realtime_events_created_at
  on public.realtime_events(created_at desc);

-- Allow efficient fan-out queries by event type.
create index if not exists idx_realtime_events_event_type
  on public.realtime_events(event_type);

-- Entity lookup (e.g. "all events for work order X").
create index if not exists idx_realtime_events_entity
  on public.realtime_events(entity_type, entity_id)
  where entity_id is not null;

-- Per-user targeting for personal feeds.
create index if not exists idx_realtime_events_target_profile
  on public.realtime_events(target_profile_id)
  where target_profile_id is not null;

-- Per-department filtering for department-scoped dashboards.
create index if not exists idx_realtime_events_department
  on public.realtime_events(department_id)
  where department_id is not null;
