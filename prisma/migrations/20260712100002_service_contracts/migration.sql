-- Service Contracts: per-asset external service/maintenance agreements

CREATE TABLE service_contracts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID        NOT NULL REFERENCES assets(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  contract_title    TEXT        NOT NULL,
  contract_number   TEXT,
  service_company   TEXT        NOT NULL,
  contact_person    TEXT,
  phone             TEXT,
  email             TEXT,
  start_date        DATE        NOT NULL,
  end_date          DATE        NOT NULL,
  renewal_date      DATE,
  service_frequency TEXT        NOT NULL DEFAULT 'One-time',
  contract_status   TEXT        NOT NULL DEFAULT 'Active',
  scope_of_service  TEXT,
  remarks           TEXT,
  created_by        UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  updated_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_sc_asset_id         ON service_contracts (asset_id);
CREATE INDEX idx_sc_contract_status  ON service_contracts (contract_status);
CREATE INDEX idx_sc_end_date         ON service_contracts (end_date);
CREATE INDEX idx_sc_deleted_at       ON service_contracts (deleted_at) WHERE deleted_at IS NULL;
