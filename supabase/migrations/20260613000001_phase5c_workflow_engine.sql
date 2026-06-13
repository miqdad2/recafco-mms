-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5-C: Workflow Engine Tables
--
-- Adds 10 new tables for the enterprise workflow engine.
-- No existing tables are altered in this migration.
-- No workflow behavior is activated — tables are schema-only at this stage.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. workflow_definitions ─────────────────────────────────────────────────
create table if not exists public.workflow_definitions (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  code        text        not null,
  entity_type text        not null,
  description text,
  version     integer     not null default 1,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_workflow_definitions_code unique (code)
);

create index if not exists idx_workflow_definitions_code
  on public.workflow_definitions(code);

create index if not exists idx_workflow_definitions_entity_active
  on public.workflow_definitions(entity_type, is_active);

drop trigger if exists trg_workflow_definitions_updated_at on public.workflow_definitions;
create trigger trg_workflow_definitions_updated_at
  before update on public.workflow_definitions
  for each row execute function public.set_updated_at();


-- ─── 2. workflow_steps ───────────────────────────────────────────────────────
create table if not exists public.workflow_steps (
  id                  uuid        primary key default gen_random_uuid(),
  workflow_def_id     uuid        not null references public.workflow_definitions(id) on delete cascade,
  step_order          integer     not null,
  code                text        not null,
  name                text        not null,
  description         text,
  required_role       text,
  required_permission text,
  is_approval_step    boolean     not null default false,
  is_final_step       boolean     not null default false,
  metadata            jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_workflow_steps_def_order unique (workflow_def_id, step_order),
  constraint uq_workflow_steps_def_code  unique (workflow_def_id, code)
);

create index if not exists idx_workflow_steps_def_id
  on public.workflow_steps(workflow_def_id);

drop trigger if exists trg_workflow_steps_updated_at on public.workflow_steps;
create trigger trg_workflow_steps_updated_at
  before update on public.workflow_steps
  for each row execute function public.set_updated_at();


-- ─── 3. workflow_instances ───────────────────────────────────────────────────
create table if not exists public.workflow_instances (
  id              uuid        primary key default gen_random_uuid(),
  workflow_def_id uuid        not null references public.workflow_definitions(id) on update no action,
  entity_type     text        not null,
  entity_id       uuid        not null,
  current_step_id uuid        references public.workflow_steps(id) on update no action,
  status          text        not null default 'active',
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_workflow_instances_entity unique (entity_type, entity_id)
);

create index if not exists idx_workflow_instances_entity
  on public.workflow_instances(entity_type, entity_id);

create index if not exists idx_workflow_instances_def_status
  on public.workflow_instances(workflow_def_id, status);

drop trigger if exists trg_workflow_instances_updated_at on public.workflow_instances;
create trigger trg_workflow_instances_updated_at
  before update on public.workflow_instances
  for each row execute function public.set_updated_at();


-- ─── 4. workflow_step_instances ──────────────────────────────────────────────
create table if not exists public.workflow_step_instances (
  id               uuid        primary key default gen_random_uuid(),
  workflow_inst_id uuid        not null references public.workflow_instances(id) on delete cascade,
  step_id          uuid        not null references public.workflow_steps(id) on update no action,
  status           text        not null default 'pending',
  actor_id         uuid,
  decision         text,
  comments         text,
  started_at       timestamptz,
  completed_at     timestamptz,
  due_at           timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_workflow_step_instances_instance
  on public.workflow_step_instances(workflow_inst_id);

create index if not exists idx_workflow_step_instances_step
  on public.workflow_step_instances(step_id);

create index if not exists idx_workflow_step_instances_actor_status
  on public.workflow_step_instances(actor_id, status);

drop trigger if exists trg_workflow_step_instances_updated_at on public.workflow_step_instances;
create trigger trg_workflow_step_instances_updated_at
  before update on public.workflow_step_instances
  for each row execute function public.set_updated_at();


-- ─── 5. clarification_requests ───────────────────────────────────────────────
create table if not exists public.clarification_requests (
  id                    uuid        primary key default gen_random_uuid(),
  workflow_step_inst_id uuid        not null references public.workflow_step_instances(id) on delete cascade,
  question              text        not null,
  requested_by          uuid,
  responded_by          uuid,
  response              text,
  status                text        not null default 'pending',
  requested_at          timestamptz not null default now(),
  responded_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_clarification_requests_step_inst
  on public.clarification_requests(workflow_step_inst_id);

create index if not exists idx_clarification_requests_status
  on public.clarification_requests(status);

drop trigger if exists trg_clarification_requests_updated_at on public.clarification_requests;
create trigger trg_clarification_requests_updated_at
  before update on public.clarification_requests
  for each row execute function public.set_updated_at();


-- ─── 6. work_order_required_parts ────────────────────────────────────────────
create table if not exists public.work_order_required_parts (
  id                uuid           primary key default gen_random_uuid(),
  work_order_id     uuid           not null references public.work_orders(id) on delete cascade,
  part_id           uuid           references public.parts(id) on update no action,
  description       text           not null,
  part_number       text,
  quantity_required numeric(12, 2) not null default 0,
  unit_of_measure   text           not null default 'PCS',
  status            text           not null default 'pending',
  notes             text,
  created_at        timestamptz    not null default now(),
  updated_at        timestamptz    not null default now(),
  created_by        uuid
);

create index if not exists idx_work_order_required_parts_wo
  on public.work_order_required_parts(work_order_id);

create index if not exists idx_work_order_required_parts_part
  on public.work_order_required_parts(part_id);

drop trigger if exists trg_work_order_required_parts_updated_at on public.work_order_required_parts;
create trigger trg_work_order_required_parts_updated_at
  before update on public.work_order_required_parts
  for each row execute function public.set_updated_at();


-- ─── 7. maintenance_teams ────────────────────────────────────────────────────
create table if not exists public.maintenance_teams (
  id          uuid        primary key default gen_random_uuid(),
  team_name   text        not null,
  team_code   text        not null,
  description text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  constraint uq_maintenance_teams_code unique (team_code)
);

create index if not exists idx_maintenance_teams_active
  on public.maintenance_teams(is_active);

drop trigger if exists trg_maintenance_teams_updated_at on public.maintenance_teams;
create trigger trg_maintenance_teams_updated_at
  before update on public.maintenance_teams
  for each row execute function public.set_updated_at();


-- ─── 8. maintenance_team_members ─────────────────────────────────────────────
create table if not exists public.maintenance_team_members (
  id         uuid        primary key default gen_random_uuid(),
  team_id    uuid        not null references public.maintenance_teams(id) on delete cascade,
  profile_id uuid        not null references public.profiles(id) on update no action,
  role       text,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  constraint uq_maintenance_team_members unique (team_id, profile_id)
);

create index if not exists idx_maintenance_team_members_team
  on public.maintenance_team_members(team_id);

create index if not exists idx_maintenance_team_members_profile
  on public.maintenance_team_members(profile_id);


-- ─── 9. purchase_orders ──────────────────────────────────────────────────────
create table if not exists public.purchase_orders (
  id                  uuid           primary key default gen_random_uuid(),
  po_number           text           not null,
  purchase_request_id uuid           references public.purchase_requests(id) on update no action,
  work_order_id       uuid,
  supplier            text,
  status              text           not null default 'Draft',
  total_amount        numeric(12, 3) not null default 0,
  currency            text           not null default 'KWD',
  approved_by         uuid,
  approved_at         timestamptz,
  ordered_at          timestamptz,
  received_at         timestamptz,
  notes               text,
  created_at          timestamptz    not null default now(),
  updated_at          timestamptz    not null default now(),
  created_by          uuid,
  constraint uq_purchase_orders_po_number unique (po_number)
);

create index if not exists idx_purchase_orders_pr
  on public.purchase_orders(purchase_request_id);

create index if not exists idx_purchase_orders_status
  on public.purchase_orders(status);

create index if not exists idx_purchase_orders_created_at
  on public.purchase_orders(created_at);

drop trigger if exists trg_purchase_orders_updated_at on public.purchase_orders;
create trigger trg_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();


-- ─── 10. purchase_order_items ─────────────────────────────────────────────────
create table if not exists public.purchase_order_items (
  id                uuid           primary key default gen_random_uuid(),
  purchase_order_id uuid           not null references public.purchase_orders(id) on delete cascade,
  part_id           uuid           references public.parts(id) on update no action,
  description       text           not null,
  quantity          numeric(12, 2) not null default 0,
  unit_price        numeric(12, 3) not null default 0,
  total_price       numeric(12, 3) not null default 0,
  received_qty      numeric(12, 2) not null default 0,
  created_at        timestamptz    not null default now()
);

create index if not exists idx_purchase_order_items_po
  on public.purchase_order_items(purchase_order_id);

create index if not exists idx_purchase_order_items_part
  on public.purchase_order_items(part_id);
