-- Opening Stock: "Register as Different Material" exception (additive).
--
-- A held row whose exact part number already belongs to an existing
-- material may be registered as a NEW material only when the Maintenance
-- Manager or System Administrator confirms it is physically different and
-- explains why. Data Entry may propose it; only an approver decides.
--
-- 1. The proposal (Data Entry) is stored beside the other corrections.
-- 2. The approver's decision is recorded in the row history with its own
--    action, so the exception is visible and auditable on its own.
-- Nothing existing is changed or removed; requires 20261126000000.

ALTER TABLE public.opening_stock_import_rows
  ADD COLUMN different_material_proposed boolean NOT NULL DEFAULT false,
  ADD COLUMN different_material_reason   text CHECK (different_material_reason IS NULL OR char_length(different_material_reason) <= 1000);

ALTER TABLE public.opening_stock_row_events
  DROP CONSTRAINT opening_stock_row_events_action_check,
  ADD CONSTRAINT opening_stock_row_events_action_check CHECK (
    action IN ('draft_saved', 'submitted', 'returned', 'kept_on_hold', 'posted_existing', 'registered_new', 'registered_different', 'excluded')
  );
