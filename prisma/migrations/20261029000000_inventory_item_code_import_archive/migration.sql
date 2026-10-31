-- Inventory Control: Item Code, Material Master Excel import history, and
-- Super Admin archive/restore. Additive only — no existing column, index,
-- constraint or row is changed.
--
-- Inventory Control has no separate material-master table: a material is a
-- ledger identity (part_id, or manual_material_name + unit) in
-- offline_inventory_movements, and inventory_material_settings is its one
-- optional per-identity row (minimum stock, unit setup). The Item Code and
-- the archive state live on that row, so every existing identity, key and
-- reference stays exactly as it is.

ALTER TABLE inventory_material_settings
  ADD COLUMN item_code      text,
  ADD COLUMN archived_at    timestamptz,
  ADD COLUMN archived_by    uuid REFERENCES profiles(id),
  ADD COLUMN archive_reason text;

-- Item Codes are stored exactly as entered (leading zeros kept), trimmed,
-- never blank.
ALTER TABLE inventory_material_settings
  ADD CONSTRAINT inventory_material_settings_item_code_check CHECK (
    item_code IS NULL OR (item_code = btrim(item_code) AND item_code <> '' AND char_length(item_code) <= 64)
  ),
  ADD CONSTRAINT inventory_material_settings_archive_check CHECK (
    (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL) OR
    (archived_at IS NOT NULL AND archived_by IS NOT NULL)
  );

-- One material per Item Code, case-insensitively (AMSHV0001 = amshv0001).
-- Materials without an Item Code are unaffected.
CREATE UNIQUE INDEX inventory_material_settings_item_code_unique
  ON inventory_material_settings (UPPER(item_code)) WHERE item_code IS NOT NULL;

-- One row per confirmed Material Master import. client_submission_id makes
-- a repeated submit of the same confirmation return the first result
-- instead of importing again.
CREATE TABLE inventory_material_import_batches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_reference        text NOT NULL UNIQUE,
  client_submission_id   uuid NOT NULL UNIQUE,
  file_name              text NOT NULL,
  sheet_name             text NOT NULL,
  has_header_row         boolean NOT NULL,
  column_mapping         jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_rows             integer NOT NULL CHECK (total_rows >= 0),
  imported_count         integer NOT NULL CHECK (imported_count >= 0),
  existing_count         integer NOT NULL DEFAULT 0 CHECK (existing_count >= 0),
  duplicate_count        integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  invalid_count          integer NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  unsupported_unit_count integer NOT NULL DEFAULT 0 CHECK (unsupported_unit_count >= 0),
  created_by             uuid NOT NULL REFERENCES profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_material_import_batches_created_at
  ON inventory_material_import_batches (created_at DESC);
