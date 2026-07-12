-- Offline Inventory Control: maintenance department ledger for received/issued/returned materials

CREATE TABLE offline_inventory_movements (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type         TEXT        NOT NULL,           -- RECEIVED | ISSUED | RETURNED | ADJUSTMENT
  movement_date         DATE        NOT NULL,
  part_id               UUID        REFERENCES parts(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  manual_material_name  TEXT,
  manual_part_number    TEXT,
  quantity              DECIMAL(12,3) NOT NULL,
  unit                  TEXT        NOT NULL DEFAULT 'PCS',
  reference_number      TEXT,
  counterparty          TEXT,                           -- received_from OR issued_to
  purpose               TEXT,
  receiver_name         TEXT,
  related_work_order_id UUID        REFERENCES work_orders(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  remarks               TEXT,
  adjustment_reason     TEXT,                           -- used when movement_type = ADJUSTMENT
  created_by            UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_oim_movement_type  ON offline_inventory_movements (movement_type);
CREATE INDEX idx_oim_movement_date  ON offline_inventory_movements (movement_date DESC);
CREATE INDEX idx_oim_part_id        ON offline_inventory_movements (part_id) WHERE part_id IS NOT NULL;
CREATE INDEX idx_oim_work_order     ON offline_inventory_movements (related_work_order_id) WHERE related_work_order_id IS NOT NULL;
CREATE INDEX idx_oim_created_by     ON offline_inventory_movements (created_by);
CREATE INDEX idx_oim_deleted_at     ON offline_inventory_movements (deleted_at) WHERE deleted_at IS NULL;
