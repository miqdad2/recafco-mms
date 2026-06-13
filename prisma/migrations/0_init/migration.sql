-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "app_settings" (
    "id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
    "company_name" TEXT NOT NULL DEFAULT 'RECAFCO',
    "default_currency" TEXT NOT NULL DEFAULT 'KWD',
    "work_order_number_format" TEXT NOT NULL DEFAULT 'REC/MD/{TYPE}/JOB/{0000}',
    "parts_request_number_format" TEXT NOT NULL DEFAULT 'REC/STORE/PR/{0000}',
    "purchase_request_number_format" TEXT NOT NULL DEFAULT 'REC/PUR/{0000}',
    "ceo_approval_threshold" DECIMAL(12,3) NOT NULL DEFAULT 1000,
    "requester_confirmation_enabled" BOOLEAN NOT NULL DEFAULT true,
    "finance_approval_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ceo_approval_enabled" BOOLEAN NOT NULL DEFAULT true,
    "logo_path" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "asset_number_format" TEXT NOT NULL DEFAULT 'REC/ASSET/{0000}',
    "notification_retention_days" INTEGER NOT NULL DEFAULT 180,
    "notification_poll_interval_seconds" INTEGER NOT NULL DEFAULT 45,
    "force_critical_notifications" BOOLEAN NOT NULL DEFAULT true,
    "max_upload_size_mb" INTEGER NOT NULL DEFAULT 10,
    "signed_url_expiry_seconds" INTEGER NOT NULL DEFAULT 300,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID,
    "parts_request_id" UUID,
    "purchase_request_id" UUID,
    "approval_type" TEXT NOT NULL DEFAULT 'Work Order',
    "status" TEXT NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "content_type" TEXT,
    "file_size" INTEGER,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset_code" TEXT NOT NULL,
    "asset_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "department_id" UUID,
    "location" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "plate_number" TEXT,
    "chassis_number" TEXT,
    "engine_number" TEXT,
    "purchase_date" DATE,
    "warranty_expiry_date" DATE,
    "registration_expiry_date" DATE,
    "insurance_expiry_date" DATE,
    "current_kilometer_reading" DECIMAL(12,2),
    "current_running_hours" DECIMAL(12,2),
    "assigned_operator_driver" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "next_service_date" DATE,
    "next_service_kilometer" DECIMAL(12,2),
    "next_service_running_hours" DECIMAL(12,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_error_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "severity" TEXT NOT NULL DEFAULT 'error',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "user_id" UUID,
    "route" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution_notes" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "manager_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "part_id" UUID NOT NULL,
    "movement_type" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "work_order_id" UUID,
    "parts_request_id" UUID,
    "purchase_request_id" UUID,
    "reference" TEXT,
    "comments" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID,
    "event_key" TEXT,
    "recipient_user_id" UUID,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "notification_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "event_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "description" TEXT NOT NULL DEFAULT '',
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "supports_in_app" BOOLEAN NOT NULL DEFAULT true,
    "supports_email" BOOLEAN NOT NULL DEFAULT false,
    "supports_whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "supports_sms" BOOLEAN NOT NULL DEFAULT false,
    "supports_push" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("event_key")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
    "push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_key" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "title_template" TEXT NOT NULL,
    "message_template" TEXT NOT NULL,
    "action_label_template" TEXT,
    "action_url_template" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "notification_type" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipient_user_id" UUID,
    "recipient_role" TEXT,
    "recipient_department_id" UUID,
    "event_key" TEXT,
    "category" TEXT NOT NULL DEFAULT 'System',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "action_url" TEXT,
    "action_label" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "numbering_sequences" (
    "key" TEXT NOT NULL,
    "current_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "numbering_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "part_code" TEXT NOT NULL,
    "part_name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "part_number" TEXT,
    "ss_rec_code" TEXT,
    "unit_of_measure" TEXT NOT NULL DEFAULT 'PCS',
    "current_stock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minimum_stock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "supplier" TEXT,
    "store_location_bin" TEXT,
    "compatible_asset_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'Active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_request_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parts_request_id" UUID NOT NULL,
    "part_id" UUID,
    "description" TEXT NOT NULL,
    "part_number" TEXT,
    "ss_rec_code" TEXT,
    "quantity_requested" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "total_price" DECIMAL(12,3) DEFAULT (COALESCE(quantity_requested, (0)::numeric) * COALESCE(unit_price, (0)::numeric)),
    "remarks" TEXT,
    "stock_availability" TEXT NOT NULL DEFAULT 'Unchecked',
    "issued_quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parts_request_number" TEXT,
    "department_id" UUID,
    "work_order_id" UUID NOT NULL,
    "asset_id" UUID,
    "remarks" TEXT,
    "request_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "request_time" TIME(6) NOT NULL DEFAULT CURRENT_TIME,
    "serial_number" TEXT,
    "requested_by" UUID,
    "prepared_by" UUID,
    "approved_by" UUID,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "approval_comments" TEXT,
    "store_issue_comments" TEXT,
    "total_price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "parts_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "employee_number" TEXT,
    "phone" TEXT,
    "job_title" TEXT,
    "department_id" UUID,
    "role_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "can_view_costs" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "override_type" TEXT NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_request_id" UUID NOT NULL,
    "parts_request_item_id" UUID,
    "part_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimated_unit_price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "estimated_total" DECIMAL(12,3) DEFAULT (COALESCE(quantity, (0)::numeric) * COALESCE(estimated_unit_price, (0)::numeric)),
    "supplier" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_request_number" TEXT,
    "work_order_id" UUID,
    "parts_request_id" UUID,
    "supplier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "purchase_officer_notes" TEXT,
    "finance_comments" TEXT,
    "ceo_comments" TEXT,
    "estimated_total" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "finance_approved_by" UUID,
    "finance_approved_at" TIMESTAMPTZ(6),
    "ceo_approved_by" UUID,
    "ceo_approved_at" TIMESTAMPTZ(6),
    "quotation_file_name" TEXT,
    "quotation_file_path" TEXT,
    "invoice_file_name" TEXT,
    "invoice_file_path" TEXT,
    "delivery_note_file_name" TEXT,
    "delivery_note_file_path" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "technician_id" UUID,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "work_order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "attachment_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "content_type" TEXT,
    "file_size" INTEGER,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_labor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "technician_id" UUID,
    "labor_name" TEXT NOT NULL,
    "employee_number" TEXT,
    "hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,3) DEFAULT (COALESCE(hours, (0)::numeric) * COALESCE(rate, (0)::numeric)),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_labor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "part_id" UUID,
    "material_name" TEXT NOT NULL,
    "part_number" TEXT,
    "ss_rec_code" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,3) DEFAULT (COALESCE(quantity, (0)::numeric) * COALESCE(unit_price, (0)::numeric)),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "work_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_technician_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "technician_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "labor_hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "photo_file_name" TEXT,
    "photo_file_path" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_technician_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_number" TEXT,
    "company_reference_format" TEXT,
    "ordered_by" TEXT NOT NULL,
    "requested_by_department_id" UUID,
    "asset_id" UUID,
    "asset_category" TEXT,
    "serial_number" TEXT,
    "plate_number" TEXT,
    "date_of_order" DATE NOT NULL DEFAULT CURRENT_DATE,
    "job_location" TEXT,
    "starting_datetime" TIMESTAMPTZ(6),
    "ending_datetime" TIMESTAMPTZ(6),
    "maintenance_type" TEXT NOT NULL,
    "worker_type" TEXT NOT NULL,
    "running_hours" DECIMAL(12,2),
    "kilometers" DECIMAL(12,2),
    "operator_complaint" TEXT,
    "description_of_work" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "assigned_supervisor_id" UUID,
    "operator_requester_confirmation" TEXT,
    "supervisor_verification" TEXT,
    "maintenance_manager_closure" TEXT,
    "next_service_date" DATE,
    "next_service_kilometer" DECIMAL(12,2),
    "next_service_running_hours" DECIMAL(12,2),
    "total_labor_cost" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "total_material_cost" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "total_work_order_cost" DECIMAL(12,3) DEFAULT (COALESCE(total_labor_cost, (0)::numeric) + COALESCE(total_material_cost, (0)::numeric)),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "password_set_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "temporary_password_set_at" TIMESTAMPTZ(6),
    "must_reset_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "backup_type" TEXT NOT NULL DEFAULT 'database',
    "status" TEXT NOT NULL,
    "file_path" TEXT,
    "file_size_bytes" BIGINT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "realtime_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "actor_profile_id" UUID,
    "target_profile_id" UUID,
    "department_id" UUID,
    "scope" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_approvals_work_order_id" ON "approvals"("work_order_id");

-- CreateIndex
CREATE INDEX "idx_approvals_parts_request_id" ON "approvals"("parts_request_id");

-- CreateIndex
CREATE INDEX "idx_approvals_purchase_request_id" ON "approvals"("purchase_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_asset_code_key" ON "assets"("asset_code");

-- CreateIndex
CREATE INDEX "idx_assets_category" ON "assets"("category");

-- CreateIndex
CREATE INDEX "idx_assets_deleted_at" ON "assets"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_assets_department_id" ON "assets"("department_id");

-- CreateIndex
CREATE INDEX "idx_assets_expiry_dates" ON "assets"("registration_expiry_date", "insurance_expiry_date", "warranty_expiry_date");

-- CreateIndex
CREATE INDEX "idx_assets_service_due" ON "assets"("next_service_date", "status");

-- CreateIndex
CREATE INDEX "idx_assets_status" ON "assets"("status");

-- CreateIndex
CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "idx_audit_logs_actor_id" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_system_error_logs_created_at" ON "system_error_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_system_error_logs_entity" ON "system_error_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_system_error_logs_severity_created" ON "system_error_logs"("severity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_system_error_logs_source_created" ON "system_error_logs"("source", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_system_error_logs_status_created" ON "system_error_logs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_system_error_logs_user_created" ON "system_error_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "idx_departments_is_active" ON "departments"("is_active");

-- CreateIndex
CREATE INDEX "idx_inventory_movements_part" ON "inventory_movements"("part_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_inventory_movements_report_filters" ON "inventory_movements"("created_at", "movement_type");

-- CreateIndex
CREATE INDEX "idx_notification_delivery_logs_event" ON "notification_delivery_logs"("event_key", "attempted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notification_delivery_logs_recipient" ON "notification_delivery_logs"("recipient_user_id", "attempted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notification_preferences_user" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_event_key_key" ON "notification_preferences"("user_id", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_key_channel_key" ON "notification_templates"("event_key", "channel");

-- CreateIndex
CREATE INDEX "idx_notifications_category" ON "notifications"("category");

-- CreateIndex
CREATE INDEX "idx_notifications_created_at" ON "notifications"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_entity" ON "notifications"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_notifications_event_key" ON "notifications"("event_key");

-- CreateIndex
CREATE INDEX "idx_notifications_is_read" ON "notifications"("is_read");

-- CreateIndex
CREATE INDEX "idx_notifications_priority" ON "notifications"("priority");

-- CreateIndex
CREATE INDEX "idx_notifications_read_at" ON "notifications"("read_at");

-- CreateIndex
CREATE INDEX "idx_notifications_recipient_created" ON "notifications"("recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_recipient_user_id" ON "notifications"("recipient_user_id");

-- CreateIndex
CREATE INDEX "idx_notifications_unarchived_recipient" ON "notifications"("recipient_user_id", "archived_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "parts_part_code_key" ON "parts"("part_code");

-- CreateIndex
CREATE INDEX "idx_parts_current_stock" ON "parts"("current_stock");

-- CreateIndex
CREATE INDEX "idx_parts_deleted_at" ON "parts"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_parts_low_stock" ON "parts"("current_stock", "minimum_stock");

-- CreateIndex
CREATE INDEX "idx_parts_status" ON "parts"("status");

-- CreateIndex
CREATE INDEX "idx_parts_request_items_request" ON "parts_request_items"("parts_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_requests_parts_request_number_key" ON "parts_requests"("parts_request_number");

-- CreateIndex
CREATE INDEX "idx_parts_requests_report_filters" ON "parts_requests"("request_date", "status", "department_id");

-- CreateIndex
CREATE INDEX "idx_parts_requests_status" ON "parts_requests"("status");

-- CreateIndex
CREATE INDEX "idx_parts_requests_work_order" ON "parts_requests"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "idx_profiles_department_id" ON "profiles"("department_id");

-- CreateIndex
CREATE INDEX "idx_profiles_is_active" ON "profiles"("is_active");

-- CreateIndex
CREATE INDEX "idx_profiles_role_id" ON "profiles"("role_id");

-- CreateIndex
CREATE INDEX "idx_upo_profile" ON "user_permission_overrides"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "upo_unique" ON "user_permission_overrides"("profile_id", "permission_key", "override_type");

-- CreateIndex
CREATE INDEX "idx_purchase_request_items_request" ON "purchase_request_items"("purchase_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_purchase_request_number_key" ON "purchase_requests"("purchase_request_number");

-- CreateIndex
CREATE INDEX "idx_purchase_requests_parts_request" ON "purchase_requests"("parts_request_id");

-- CreateIndex
CREATE INDEX "idx_purchase_requests_report_filters" ON "purchase_requests"("created_at", "status");

-- CreateIndex
CREATE INDEX "idx_purchase_requests_status" ON "purchase_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "roles_slug_key" ON "roles"("slug");

-- CreateIndex
CREATE INDEX "idx_work_order_assignments_technician" ON "work_order_assignments"("technician_id");

-- CreateIndex
CREATE INDEX "idx_work_order_status_history_work_order" ON "work_order_status_history"("work_order_id", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "idx_work_order_technician_notes_technician" ON "work_order_technician_notes"("technician_id");

-- CreateIndex
CREATE INDEX "idx_work_order_technician_notes_work_order" ON "work_order_technician_notes"("work_order_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_work_order_number_key" ON "work_orders"("work_order_number");

-- CreateIndex
CREATE INDEX "idx_work_orders_asset_id" ON "work_orders"("asset_id");

-- CreateIndex
CREATE INDEX "idx_work_orders_created_at" ON "work_orders"("created_at");

-- CreateIndex
CREATE INDEX "idx_work_orders_deleted_at" ON "work_orders"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_work_orders_department_id" ON "work_orders"("requested_by_department_id");

-- CreateIndex
CREATE INDEX "idx_work_orders_number" ON "work_orders"("work_order_number");

-- CreateIndex
CREATE INDEX "idx_work_orders_report_filters" ON "work_orders"("date_of_order", "status", "maintenance_type", "worker_type", "priority");

-- CreateIndex
CREATE INDEX "idx_work_orders_status" ON "work_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_session_token_hash_key" ON "auth_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_profile_expiry_idx" ON "auth_sessions"("profile_id", "expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_user_expiry_idx" ON "auth_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_profile_id_key" ON "auth_users"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_email_key" ON "auth_users"("email");

-- CreateIndex
CREATE INDEX "idx_backup_logs_created_at" ON "backup_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_backup_logs_status" ON "backup_logs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_realtime_events_created_at" ON "realtime_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_realtime_events_event_type" ON "realtime_events"("event_type");

-- CreateIndex
CREATE INDEX "idx_realtime_events_entity" ON "realtime_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_realtime_events_target_profile" ON "realtime_events"("target_profile_id");

-- CreateIndex
CREATE INDEX "idx_realtime_events_department" ON "realtime_events"("department_id");

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_parts_request_id_fkey" FOREIGN KEY ("parts_request_id") REFERENCES "parts_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_parts_request_id_fkey" FOREIGN KEY ("parts_request_id") REFERENCES "parts_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purchase_request_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_delivery_logs" ADD CONSTRAINT "notification_delivery_logs_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "notification_events"("event_key") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_event_key_fkey" FOREIGN KEY ("event_key") REFERENCES "notification_events"("event_key") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_department_id_fkey" FOREIGN KEY ("recipient_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts_request_items" ADD CONSTRAINT "parts_request_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts_request_items" ADD CONSTRAINT "parts_request_items_parts_request_id_fkey" FOREIGN KEY ("parts_request_id") REFERENCES "parts_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_prepared_by_fkey" FOREIGN KEY ("prepared_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_parts_request_item_id_fkey" FOREIGN KEY ("parts_request_item_id") REFERENCES "parts_request_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_ceo_approved_by_fkey" FOREIGN KEY ("ceo_approved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_finance_approved_by_fkey" FOREIGN KEY ("finance_approved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_parts_request_id_fkey" FOREIGN KEY ("parts_request_id") REFERENCES "parts_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_attachments" ADD CONSTRAINT "work_order_attachments_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_labor" ADD CONSTRAINT "work_order_labor_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_labor" ADD CONSTRAINT "work_order_labor_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_status_history" ADD CONSTRAINT "work_order_status_history_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_technician_notes" ADD CONSTRAINT "work_order_technician_notes_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_technician_notes" ADD CONSTRAINT "work_order_technician_notes_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_supervisor_id_fkey" FOREIGN KEY ("assigned_supervisor_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_requested_by_department_id_fkey" FOREIGN KEY ("requested_by_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_users" ADD CONSTRAINT "auth_users_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

