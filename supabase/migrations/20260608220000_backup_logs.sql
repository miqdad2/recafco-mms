-- Migration: backup_logs table
-- Records database backup runs: status, timing, file path, size, and errors.

CREATE TABLE public.backup_logs (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  backup_type      TEXT        NOT NULL DEFAULT 'database',
  status           TEXT        NOT NULL,
  file_path        TEXT,
  file_size_bytes  BIGINT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT backup_logs_pkey         PRIMARY KEY (id),
  CONSTRAINT backup_logs_status_check CHECK (status IN ('running', 'success', 'failed'))
);

CREATE INDEX idx_backup_logs_created_at ON public.backup_logs (created_at DESC);
CREATE INDEX idx_backup_logs_status     ON public.backup_logs (status, created_at DESC);

COMMENT ON TABLE  public.backup_logs                  IS 'Records each database backup run with outcome, timing, and file details.';
COMMENT ON COLUMN public.backup_logs.backup_type      IS 'Type of backup — always ''database'' for now; reserved for future upload/config backups.';
COMMENT ON COLUMN public.backup_logs.status           IS 'running | success | failed';
COMMENT ON COLUMN public.backup_logs.file_path        IS 'Absolute path to the .dump file on the server, or NULL when the backup failed.';
COMMENT ON COLUMN public.backup_logs.file_size_bytes  IS 'Size of the dump file in bytes, or NULL when the backup failed.';
COMMENT ON COLUMN public.backup_logs.started_at       IS 'Timestamp when the backup script started (UTC).';
COMMENT ON COLUMN public.backup_logs.completed_at     IS 'Timestamp when the backup run finished (success or failure).';
COMMENT ON COLUMN public.backup_logs.error_message    IS 'Truncated error description when status = failed.';
