-- work_orders_job_card_opened_at_check compared the Kuwait day with
-- job_card_start_date, but a NULL date makes that comparison NULL, which a
-- CHECK accepts. An opening moment now also requires the date. No row has
-- job_card_opened_at set without a date: the application refuses it.

ALTER TABLE work_orders DROP CONSTRAINT work_orders_job_card_opened_at_check;

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_job_card_opened_at_check CHECK (
    job_card_opened_at IS NULL
    OR (
      job_card_start_date IS NOT NULL
      AND (job_card_opened_at AT TIME ZONE 'Asia/Kuwait')::date = job_card_start_date
    )
  );
