-- Job Card "No Workers Required" / "No Materials Required" confirmations.
--
-- Workers and materials stay optional when a Job Card is created. Before
-- closure can be requested, each must be either present (workers finished,
-- materials fully processed) or explicitly confirmed as not required — an
-- empty list is never taken as "done" by itself.
--
-- One row per confirmation. A confirmation is active while superseded_at is
-- NULL (at most one active row per Job Card and requirement — partial unique
-- index). When workers or materials are later added, the active row is
-- superseded (superseded_at / superseded_by / superseded_reason set), never
-- deleted, so the history of who confirmed what and when is kept. Foreign
-- keys are RESTRICT so history can never be removed by a cascade.
--
-- Additive only: one new table, no existing row or column is changed.

CREATE TABLE job_card_requirement_confirmations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id      uuid NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  requirement        text NOT NULL,
  -- Required for "workers" (why no worker was needed); optional for "materials".
  reason             text,
  confirmed_by       uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  confirmed_at       timestamptz NOT NULL DEFAULT now(),
  superseded_at      timestamptz,
  superseded_by      uuid REFERENCES profiles(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  superseded_reason  text,
  CONSTRAINT job_card_requirement_confirmations_requirement_check CHECK (requirement IN ('workers', 'materials')),
  CONSTRAINT job_card_requirement_confirmations_workers_reason_check CHECK (requirement <> 'workers' OR char_length(btrim(coalesce(reason, ''))) >= 3),
  CONSTRAINT job_card_requirement_confirmations_superseded_check CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);

CREATE UNIQUE INDEX uq_job_card_requirement_confirmations_one_active
  ON job_card_requirement_confirmations (work_order_id, requirement) WHERE superseded_at IS NULL;
CREATE INDEX idx_job_card_requirement_confirmations_work_order
  ON job_card_requirement_confirmations (work_order_id, confirmed_at DESC);
