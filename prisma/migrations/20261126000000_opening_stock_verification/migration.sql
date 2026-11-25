-- Needs Verification workflow for held Opening Stock rows. Additive only:
-- new nullable columns on opening_stock_import_rows, one new history table,
-- and a trigger that keeps the original Excel values unchangeable. No
-- existing column, constraint, index or row is changed.
--
-- Corrections are stored BESIDE the original source values (never over
-- them). The importer matches and posts with the corrected values only when
-- an approver (System Administrator / Maintenance Manager) resolves the row.

ALTER TABLE opening_stock_import_rows
  -- Held rows only: NULL = not touched yet, draft = Data Entry is
  -- correcting, submitted = waiting for the Manager, returned = sent back
  -- for correction, on_hold = Manager kept it pending.
  ADD COLUMN verification_status   text CHECK (verification_status IN ('draft', 'submitted', 'returned', 'on_hold')),
  ADD COLUMN corrected_material_name text CHECK (corrected_material_name IS NULL OR (btrim(corrected_material_name) <> '' AND char_length(corrected_material_name) <= 300)),
  ADD COLUMN corrected_part_number   text CHECK (corrected_part_number IS NULL OR char_length(corrected_part_number) <= 120),
  ADD COLUMN corrected_category      text CHECK (corrected_category IS NULL OR char_length(corrected_category) <= 120),
  ADD COLUMN corrected_unit          text CHECK (corrected_unit IS NULL OR (btrim(corrected_unit) <> '' AND char_length(corrected_unit) <= 32)),
  ADD COLUMN corrected_quantity      numeric(12, 3) CHECK (corrected_quantity IS NULL OR (corrected_quantity > 0 AND corrected_quantity = trunc(corrected_quantity))),
  ADD COLUMN correction_remarks      text CHECK (correction_remarks IS NULL OR char_length(correction_remarks) <= 1000),
  -- The existing material Data Entry believes this row is (a suggestion; the
  -- approver still decides).
  ADD COLUMN proposed_material_key   text,
  ADD COLUMN correction_reason       text CHECK (correction_reason IS NULL OR char_length(correction_reason) <= 1000),
  ADD COLUMN corrected_by            uuid REFERENCES profiles(id),
  ADD COLUMN corrected_at            timestamptz,
  ADD COLUMN submitted_by            uuid REFERENCES profiles(id),
  ADD COLUMN submitted_at            timestamptz,
  ADD COLUMN review_note             text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  ADD COLUMN reviewed_by             uuid REFERENCES profiles(id),
  ADD COLUMN reviewed_at             timestamptz,
  -- Optimistic concurrency: every verification write bumps it, and a write
  -- made against an older version is refused.
  ADD COLUMN row_version             integer NOT NULL DEFAULT 0;

-- Every verification step of a row: who, when, from which status to which,
-- the note, and the values involved. Rows are never updated or deleted.
CREATE TABLE opening_stock_row_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id      uuid NOT NULL REFERENCES opening_stock_import_rows(id) ON DELETE RESTRICT,
  batch_id    uuid NOT NULL REFERENCES opening_stock_import_batches(id) ON DELETE RESTRICT,
  action      text NOT NULL CHECK (action IN ('draft_saved', 'submitted', 'returned', 'kept_on_hold', 'posted_existing', 'registered_new', 'excluded')),
  from_status text NOT NULL,
  to_status   text NOT NULL,
  actor_id    uuid NOT NULL REFERENCES profiles(id),
  note        text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_opening_stock_row_events_row ON opening_stock_row_events (row_id, created_at);

-- The values supplied in the approved Excel file are the audit record:
-- they can never be changed once the row exists.
CREATE FUNCTION opening_stock_import_rows_keep_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.row_number IS DISTINCT FROM OLD.row_number
     OR NEW.source_material_name IS DISTINCT FROM OLD.source_material_name
     OR NEW.source_category IS DISTINCT FROM OLD.source_category
     OR NEW.source_part_number IS DISTINCT FROM OLD.source_part_number
     OR NEW.source_ss_rec_code IS DISTINCT FROM OLD.source_ss_rec_code
     OR NEW.source_quantity IS DISTINCT FROM OLD.source_quantity
     OR NEW.source_unit IS DISTINCT FROM OLD.source_unit
     OR NEW.source_location IS DISTINCT FROM OLD.source_location
     OR NEW.source_remarks IS DISTINCT FROM OLD.source_remarks
     OR NEW.classification IS DISTINCT FROM OLD.classification THEN
    RAISE EXCEPTION 'The original values of an opening-stock import row cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opening_stock_import_rows_keep_source
  BEFORE UPDATE ON opening_stock_import_rows
  FOR EACH ROW EXECUTE FUNCTION opening_stock_import_rows_keep_source();
