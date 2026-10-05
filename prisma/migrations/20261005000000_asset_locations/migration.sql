-- Asset Location Master and Send-to-Site Dropdown.
--
-- asset_locations is the controlled list of sites / projects an asset can be
-- sent to, so "Salmi 1604" is not typed three different ways. Names are
-- unique case-insensitively; a code is optional and unique when present.
-- A location that was used is deactivated, not deleted (the application
-- refuses the delete) — inactive rows drop out of the Send to Site dropdown.
-- created_by / updated_by are plain uuid columns with no FK, same convention
-- as asset_movements.sent_by_user_id.
--
-- asset_movements gains a nullable asset_location_id. to_location stays and
-- is still written on every movement: it is the name snapshot at the time,
-- so renaming a location later never rewrites history, and every older
-- movement (asset_location_id NULL) keeps displaying its typed text.
-- Additive only; no existing row is changed.

CREATE TABLE asset_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text,
  type        text NOT NULL DEFAULT 'OTHER',
  remarks     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  CONSTRAINT asset_locations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT asset_locations_type_check
    CHECK (type IN ('PROJECT_SITE', 'STORE', 'WORKSHOP', 'DEPARTMENT', 'YARD', 'OTHER'))
);

CREATE UNIQUE INDEX idx_asset_locations_name_lower ON asset_locations (lower(name));
CREATE UNIQUE INDEX idx_asset_locations_code_lower ON asset_locations (lower(code)) WHERE code IS NOT NULL;

ALTER TABLE asset_movements
  ADD COLUMN asset_location_id uuid REFERENCES asset_locations(id);

CREATE INDEX idx_asset_movements_asset_location_id ON asset_movements(asset_location_id);
