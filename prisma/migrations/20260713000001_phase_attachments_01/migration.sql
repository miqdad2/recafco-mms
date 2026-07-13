-- Phase Attachments-01: parts_request_attachments table
-- Stores file attachments for Materials Requests.
-- Files are kept in the work-order-files bucket under the linked
-- work_order_id folder so the existing file-serving access checks apply.

CREATE TABLE "public"."parts_request_attachments" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "parts_request_id"  UUID        NOT NULL,
    "work_order_id"     UUID,
    "attachment_type"   TEXT        NOT NULL,
    "file_name"         TEXT        NOT NULL,
    "file_path"         TEXT        NOT NULL,
    "content_type"      TEXT,
    "file_size"         INTEGER,
    "uploaded_by"       UUID,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "parts_request_attachments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."parts_request_attachments"
    ADD CONSTRAINT "parts_request_attachments_parts_request_id_fkey"
    FOREIGN KEY ("parts_request_id")
    REFERENCES "public"."parts_requests"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX "idx_pr_attachments_parts_request"
    ON "public"."parts_request_attachments"("parts_request_id");
