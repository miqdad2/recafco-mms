-- Opening Stock Excel import: batch and per-row tracking. Additive only — no
-- existing column, index, constraint or row is changed.
--
-- One batch row per committed import, one row record per source row (every
-- row of the file, imported or not), so each import can be reconciled row by
-- row against the file the Maintenance Team supplied. Clear rows post stock
-- when the batch is imported; uncertain rows are held and resolved later from
-- the same batch (their source values are kept here, so the file is never
-- uploaded again).
--
--   client_submission_id  a repeated submit of the same confirmation returns
--                         the first result instead of importing again
--   file_sha256           the same file cannot be imported twice, even under
--                         a new submission id
--   content_sha256        the same rows cannot be imported twice from a
--                         re-saved copy of the file (different bytes)

CREATE TABLE opening_stock_import_batches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_reference        text NOT NULL UNIQUE,
  client_submission_id   uuid NOT NULL UNIQUE,
  file_name              text NOT NULL,
  file_sha256            text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256         text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  sheet_name             text NOT NULL,
  total_rows             integer NOT NULL CHECK (total_rows >= 0),
  posted_existing_count  integer NOT NULL DEFAULT 0 CHECK (posted_existing_count >= 0),
  registered_new_count   integer NOT NULL DEFAULT 0 CHECK (registered_new_count >= 0),
  held_count             integer NOT NULL DEFAULT 0 CHECK (held_count >= 0),
  not_imported_count     integer NOT NULL DEFAULT 0 CHECK (not_imported_count >= 0),
  excluded_count         integer NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),
  posted_quantity        numeric(14, 3) NOT NULL DEFAULT 0 CHECK (posted_quantity >= 0),
  created_by             uuid NOT NULL REFERENCES profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opening_stock_import_batches_rows_check CHECK (
    posted_existing_count + registered_new_count + held_count + not_imported_count + excluded_count = total_rows
  )
);

CREATE UNIQUE INDEX opening_stock_import_batches_file_sha256_unique ON opening_stock_import_batches (file_sha256);
CREATE UNIQUE INDEX opening_stock_import_batches_content_sha256_unique ON opening_stock_import_batches (content_sha256);
CREATE INDEX idx_opening_stock_import_batches_created_at ON opening_stock_import_batches (created_at DESC);

CREATE TABLE opening_stock_import_rows (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id               uuid NOT NULL REFERENCES opening_stock_import_batches(id) ON DELETE RESTRICT,
  row_number             integer NOT NULL CHECK (row_number > 0),
  -- The row exactly as supplied.
  source_material_name   text NOT NULL,
  source_category        text NOT NULL DEFAULT '',
  source_part_number     text NOT NULL DEFAULT '',
  source_ss_rec_code     text NOT NULL DEFAULT '',
  source_quantity        text NOT NULL DEFAULT '',
  source_unit            text NOT NULL DEFAULT '',
  source_location        text NOT NULL DEFAULT '',
  source_remarks         text NOT NULL DEFAULT '',
  -- What the matching engine found, and what happened.
  classification         text NOT NULL CHECK (classification IN ('existing', 'new', 'needs_review', 'duplicate_in_file', 'already_imported', 'invalid')),
  -- posted_existing / registered_new: stock recorded. held: waiting for a
  -- decision. not_imported: the row cannot post stock (invalid, already
  -- imported). excluded: an approver closed a held row without stock.
  outcome                text NOT NULL CHECK (outcome IN ('posted_existing', 'registered_new', 'held', 'not_imported', 'excluded')),
  message                text NOT NULL DEFAULT '',
  -- Set when an approver (System Administrator / Maintenance Manager) made
  -- the decision instead of the proposed action.
  decided_by             uuid REFERENCES profiles(id),
  resolved_at            timestamptz,
  resolution_note        text,
  -- An approved reversal of a posted row (its movement soft-deleted by a
  -- Super Admin correction) is recorded here; the material may then receive
  -- opening stock from a later import. Nothing in the importer sets these.
  reversed_at            timestamptz,
  reversed_by            uuid REFERENCES profiles(id),
  reversal_note          text,
  candidate_keys         jsonb NOT NULL DEFAULT '[]'::jsonb,
  material_key           text,
  material_name          text,
  material_unit          text,
  item_code              text,
  quantity               numeric(12, 3),
  movement_id            uuid REFERENCES offline_inventory_movements(id) ON DELETE RESTRICT,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opening_stock_import_rows_batch_row_unique UNIQUE (batch_id, row_number),
  -- A posted row always has its movement and material; any other row has none.
  CONSTRAINT opening_stock_import_rows_posted_shape_check CHECK (
    (outcome IN ('posted_existing', 'registered_new')
      AND movement_id IS NOT NULL AND material_key IS NOT NULL AND quantity IS NOT NULL AND quantity > 0)
    OR (outcome IN ('held', 'not_imported', 'excluded') AND movement_id IS NULL)
  ),
  CONSTRAINT opening_stock_import_rows_new_code_check CHECK (outcome <> 'registered_new' OR item_code IS NOT NULL),
  CONSTRAINT opening_stock_import_rows_excluded_check CHECK (outcome <> 'excluded' OR (decided_by IS NOT NULL AND resolution_note IS NOT NULL)),
  CONSTRAINT opening_stock_import_rows_reversal_check CHECK (
    (reversed_at IS NULL AND reversed_by IS NULL AND reversal_note IS NULL)
    OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_note IS NOT NULL AND outcome IN ('posted_existing', 'registered_new'))
  )
);

CREATE UNIQUE INDEX opening_stock_import_rows_movement_unique ON opening_stock_import_rows (movement_id) WHERE movement_id IS NOT NULL;
-- Import idempotency guard in the database itself: one material receives
-- opening stock from one (un-reversed) IMPORT row, across every batch. It
-- covers this table only — offline_inventory_movements gets no new
-- constraint, so the Material Master's zero-quantity registration rows,
-- Add Opening Stock, Receive, Issue and every other stock operation are
-- unaffected.
CREATE UNIQUE INDEX opening_stock_import_rows_material_posted_unique
  ON opening_stock_import_rows (material_key) WHERE outcome IN ('posted_existing', 'registered_new') AND reversed_at IS NULL;
CREATE INDEX idx_opening_stock_import_rows_held ON opening_stock_import_rows (batch_id) WHERE outcome = 'held';
