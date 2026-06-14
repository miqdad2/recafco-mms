-- Phase 5-E1: Inventory Check Schema Foundation
-- Additive only. No existing tables altered destructively. No behavior activated.
-- inventory_check_enabled defaults false — all existing flows unchanged.

-- AlterTable: app_settings — add inventory check feature flag
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "inventory_check_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: work_order_required_parts — add Store Keeper confirmation fields
ALTER TABLE "work_order_required_parts"
  ADD COLUMN IF NOT EXISTS "availability_status" TEXT         NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS "confirmed_by"         UUID,
  ADD COLUMN IF NOT EXISTS "confirmed_at"         TIMESTAMPTZ(6);

-- AddForeignKey: confirmed_by → profiles(id)
ALTER TABLE "work_order_required_parts"
  ADD CONSTRAINT "work_order_required_parts_confirmed_by_fkey"
  FOREIGN KEY ("confirmed_by")
  REFERENCES "profiles"("id")
  ON DELETE SET NULL
  ON UPDATE NO ACTION;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_work_order_required_parts_availability"
  ON "work_order_required_parts"("availability_status");

CREATE INDEX IF NOT EXISTS "idx_work_order_required_parts_confirmed_by"
  ON "work_order_required_parts"("confirmed_by");
