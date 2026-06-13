-- Phase 5-C: Workflow Engine Tables
-- Additive only. No existing tables altered. No existing indexes dropped.
-- Generated via prisma migrate diff (destructive drift statements excluded).

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_def_id" UUID NOT NULL,
    "step_order" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "required_role" TEXT,
    "required_permission" TEXT,
    "is_approval_step" BOOLEAN NOT NULL DEFAULT false,
    "is_final_step" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_def_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "current_step_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_step_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_inst_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actor_id" UUID,
    "decision" TEXT,
    "comments" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_step_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clarification_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_step_inst_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "requested_by" UUID,
    "responded_by" UUID,
    "response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clarification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_required_parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "work_order_id" UUID NOT NULL,
    "part_id" UUID,
    "description" TEXT NOT NULL,
    "part_number" TEXT,
    "quantity_required" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit_of_measure" TEXT NOT NULL DEFAULT 'PCS',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "work_order_required_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_name" TEXT NOT NULL,
    "team_code" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "maintenance_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" TEXT,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),

    CONSTRAINT "maintenance_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "po_number" TEXT NOT NULL,
    "purchase_request_id" UUID,
    "work_order_id" UUID,
    "supplier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "total_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KWD',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "ordered_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "part_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "total_price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_code_key" ON "workflow_definitions"("code");

-- CreateIndex
CREATE INDEX "idx_workflow_definitions_code" ON "workflow_definitions"("code");

-- CreateIndex
CREATE INDEX "idx_workflow_definitions_entity_active" ON "workflow_definitions"("entity_type", "is_active");

-- CreateIndex
CREATE INDEX "idx_workflow_steps_def_id" ON "workflow_steps"("workflow_def_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workflow_steps_def_order" ON "workflow_steps"("workflow_def_id", "step_order");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workflow_steps_def_code" ON "workflow_steps"("workflow_def_id", "code");

-- CreateIndex
CREATE INDEX "idx_workflow_instances_entity" ON "workflow_instances"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_workflow_instances_def_status" ON "workflow_instances"("workflow_def_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workflow_instances_entity" ON "workflow_instances"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_workflow_step_instances_instance" ON "workflow_step_instances"("workflow_inst_id");

-- CreateIndex
CREATE INDEX "idx_workflow_step_instances_step" ON "workflow_step_instances"("step_id");

-- CreateIndex
CREATE INDEX "idx_workflow_step_instances_actor_status" ON "workflow_step_instances"("actor_id", "status");

-- CreateIndex
CREATE INDEX "idx_clarification_requests_step_inst" ON "clarification_requests"("workflow_step_inst_id");

-- CreateIndex
CREATE INDEX "idx_clarification_requests_status" ON "clarification_requests"("status");

-- CreateIndex
CREATE INDEX "idx_work_order_required_parts_wo" ON "work_order_required_parts"("work_order_id");

-- CreateIndex
CREATE INDEX "idx_work_order_required_parts_part" ON "work_order_required_parts"("part_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_teams_team_code_key" ON "maintenance_teams"("team_code");

-- CreateIndex
CREATE INDEX "idx_maintenance_teams_active" ON "maintenance_teams"("is_active");

-- CreateIndex
CREATE INDEX "idx_maintenance_team_members_team" ON "maintenance_team_members"("team_id");

-- CreateIndex
CREATE INDEX "idx_maintenance_team_members_profile" ON "maintenance_team_members"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_maintenance_team_members" ON "maintenance_team_members"("team_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "idx_purchase_orders_pr" ON "purchase_orders"("purchase_request_id");

-- CreateIndex
CREATE INDEX "idx_purchase_orders_status" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "idx_purchase_orders_created_at" ON "purchase_orders"("created_at");

-- CreateIndex
CREATE INDEX "idx_purchase_order_items_po" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "idx_purchase_order_items_part" ON "purchase_order_items"("part_id");

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_def_id_fkey" FOREIGN KEY ("workflow_def_id") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_workflow_def_id_fkey" FOREIGN KEY ("workflow_def_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_current_step_id_fkey" FOREIGN KEY ("current_step_id") REFERENCES "workflow_steps"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workflow_step_instances" ADD CONSTRAINT "workflow_step_instances_workflow_inst_id_fkey" FOREIGN KEY ("workflow_inst_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workflow_step_instances" ADD CONSTRAINT "workflow_step_instances_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "workflow_steps"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "clarification_requests" ADD CONSTRAINT "clarification_requests_workflow_step_inst_id_fkey" FOREIGN KEY ("workflow_step_inst_id") REFERENCES "workflow_step_instances"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_required_parts" ADD CONSTRAINT "work_order_required_parts_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_order_required_parts" ADD CONSTRAINT "work_order_required_parts_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "maintenance_team_members" ADD CONSTRAINT "maintenance_team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "maintenance_teams"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "maintenance_team_members" ADD CONSTRAINT "maintenance_team_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
