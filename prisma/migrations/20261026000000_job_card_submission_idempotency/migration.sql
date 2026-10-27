-- Job Card Creation Reliability: server-side idempotency for New Job Card.
--
-- The New Job Card wizard sends one random submission id per intended Job
-- Card and reuses it on every retry of that same submission. The create
-- service stores it here inside the same transaction as the Job Card, so a
-- retry after an uncertain network outcome (or a double click) finds the
-- Job Card that was already committed instead of creating a second one.
-- The unique index is the backstop for two requests racing each other.
--
-- Additive only: nullable column, no default, no existing row is changed.
-- Job Cards created before this migration (and by any other path) keep NULL,
-- and a unique index allows any number of NULLs. Numbering is untouched.

ALTER TABLE work_orders ADD COLUMN client_submission_id uuid;

CREATE UNIQUE INDEX work_orders_client_submission_id_key
  ON work_orders (client_submission_id);
