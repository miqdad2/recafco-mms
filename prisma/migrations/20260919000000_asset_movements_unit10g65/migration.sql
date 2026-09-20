-- Asset Site Movement / Deployment Tracking Unit 10G.65, Task 1.
--
-- One record per deployment (not separate send/return event rows), per the
-- task's own "Preferred structure" instruction: a movement starts ACTIVE on
-- Send to Site and is updated in place to RETURNED on Receive Back
-- (actual_return_date filled, status flipped) — so there is always exactly
-- one row per real-world deployment trip. asset_id is a hard FK (assets are
-- never hard-deleted, only soft-deleted via deleted_at, so this can never
-- orphan). sent_by_user_id/received_by_user_id are plain scalar uuid
-- columns with no FK/relation to profiles — same convention already used by
-- assets.created_by/updated_by and general_inventory_requests.requested_by_id
-- — so this migration does not alter any existing table.
--
-- A partial unique index enforces "at most one ACTIVE movement per asset" at
-- the database level, backing Task 2's "show Send to Site only when the
-- asset is not already actively deployed" with a real constraint rather than
-- only a UI convention.

CREATE TABLE asset_movements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id              uuid NOT NULL REFERENCES public.assets(id),
  status                text NOT NULL DEFAULT 'ACTIVE',
  from_location         text,
  to_location           text NOT NULL,
  sent_date             date NOT NULL,
  expected_return_date  date,
  actual_return_date    date,
  sent_by_user_id       uuid,
  received_by_user_id   uuid,
  responsible_person    text,
  purpose               text,
  remarks               text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_movements_status_check
    CHECK (status IN ('ACTIVE', 'RETURNED', 'CANCELLED'))
);

CREATE UNIQUE INDEX idx_asset_movements_one_active_per_asset
  ON asset_movements(asset_id)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_asset_movements_asset_id ON asset_movements(asset_id);
CREATE INDEX idx_asset_movements_status ON asset_movements(status);
