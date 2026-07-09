-- Performance indexes for high-growth tables.
-- CREATE INDEX IF NOT EXISTS is idempotent — safe to run on any state.

-- work_orders: data-entry dashboard (created_by), overdue query (starting_datetime),
-- month-based closure query (updated_at)
CREATE INDEX IF NOT EXISTS idx_work_orders_created_by
  ON public.work_orders (created_by);

CREATE INDEX IF NOT EXISTS idx_work_orders_starting_datetime
  ON public.work_orders (starting_datetime);

CREATE INDEX IF NOT EXISTS idx_work_orders_updated_at
  ON public.work_orders (updated_at DESC);

-- work_order_assignments: work_order_id lookup for the assignments page join
-- (technician_id is already indexed; work_order_id was missing)
CREATE INDEX IF NOT EXISTS idx_work_order_assignments_work_order_id
  ON public.work_order_assignments (work_order_id);

-- parts_requests: created_at for list-page ordering
CREATE INDEX IF NOT EXISTS idx_parts_requests_created_at
  ON public.parts_requests (created_at DESC);

-- purchase_requests: updated_at for month-based finance approval queries
CREATE INDEX IF NOT EXISTS idx_purchase_requests_updated_at
  ON public.purchase_requests (updated_at DESC);

-- inventory_movements: work_order and parts_request lookups for history views
CREATE INDEX IF NOT EXISTS idx_inventory_movements_work_order_id
  ON public.inventory_movements (work_order_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_parts_request_id
  ON public.inventory_movements (parts_request_id);

-- audit_logs: entity-level lookup (action and actor_id are already indexed)
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type
  ON public.audit_logs (entity_type);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id
  ON public.audit_logs (entity_id);
