-- Phase MaintenanceStore-01: add SS Rec. Code (future SAP mapping) and a direct
-- link to the originating Materials Request on Maintenance Store movements.
-- Additive only — no existing columns/data are touched.

ALTER TABLE "offline_inventory_movements"
  ADD COLUMN "ss_rec_code" TEXT,
  ADD COLUMN "parts_request_id" UUID;

ALTER TABLE "offline_inventory_movements"
  ADD CONSTRAINT "offline_inventory_movements_parts_request_id_fkey"
  FOREIGN KEY ("parts_request_id") REFERENCES "parts_requests"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "idx_oim_parts_request_id" ON "offline_inventory_movements"("parts_request_id");
