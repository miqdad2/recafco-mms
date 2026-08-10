"use server";

import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import {
  getMaterialFulfillmentForWorkOrder,
  summarizeMaterialAvailability,
} from "@/lib/work-orders/material-fulfillment";

// Critical Workflow Popup Review Modal Unit 10G.7, Task 4/7.
//
// A DELIBERATELY lightweight fetch for the "New Active Job Card" critical
// popup's summary modal — distinct from getClosureReviewDetailAction
// (app/actions/closure-requests.ts), which stays the closure-request path's
// own full review data. Task 7 forbids full audit logs, full attachments
// (count only), and full worker session history here: no
// getWorkOrderLaborSummariesBulk call (that fetches every non-cancelled
// session row to compute hours/pay this modal never shows), just a plain
// assignment count and a single "is anything active right now" check.

function assertIsManagerRole(context: CurrentUserContext) {
  if (context.role?.slug !== "super_admin" && context.role?.slug !== "maintenance_manager") {
    throw new Error("Only a Manager can view this Job Card summary.");
  }
}

function materialsStatusLabel(status: ReturnType<typeof summarizeMaterialAvailability>): string {
  if (status === "fulfilled") return "Fully Issued";
  if (status === "partial") return "Partially Issued";
  if (status === "issuable") return "Ready to Issue";
  if (status === "shortage") return "Materials Pending";
  return "No Materials Required";
}

export type JobCardSummaryDetail = {
  id: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string;
  status: string;
  createdAtLabel: string;
  requestedByName: string | null;
  workTeam: string;
  assignmentStatusLabel: string;
  workersCount: number;
  materialsStatusLabel: string;
  attachmentsCount: number;
  nextAction: string;
  detailHref: string;
};

function formatDateTimeLabel(v: Date): string {
  return v.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export async function getJobCardSummaryAction(workOrderId: string): Promise<JobCardSummaryDetail | null> {
  const context = await requireUser();
  assertIsManagerRole(context);
  const visibilityFilter = getWorkOrderVisibilityFilter(context);

  const wo = await prisma.work_orders.findFirst({
    where: { id: workOrderId, deleted_at: null, AND: [visibilityFilter] },
    select: {
      id: true, work_order_number: true, status: true, created_at: true, created_by: true,
      operator_complaint: true, description_of_work: true, worker_type: true,
      assets: { select: { asset_name: true, plate_number: true } },
      work_order_worker_assignments: { where: { status: "active" }, select: { id: true } },
      _count: { select: { work_order_attachments: true } },
    },
  });
  if (!wo) return null;

  const [requester, activeSession, fulfillment] = await Promise.all([
    wo.created_by ? prisma.profiles.findUnique({ where: { id: wo.created_by }, select: { full_name: true } }) : Promise.resolve(null),
    prisma.workOrderWorkSession.findFirst({ where: { work_order_id: wo.id, status: { in: ["Active", "Paused"] } }, select: { status: true } }),
    getMaterialFulfillmentForWorkOrder(prisma, wo.id),
  ]);

  const workersCount = wo.work_order_worker_assignments.length;
  const hasAssignment = workersCount > 0;
  const assignmentStatusLabel = !hasAssignment
    ? "No workers assigned"
    : `${workersCount} worker${workersCount !== 1 ? "s" : ""}${activeSession?.status === "Active" ? " · Working Now" : activeSession?.status === "Paused" ? " · Paused" : ""}`;

  const materialsAvailability = summarizeMaterialAvailability(fulfillment);
  const materialsBlocking = materialsAvailability === "shortage" || materialsAvailability === "partial";

  // Task 4 — simple, deterministic priority (materials block progress first,
  // then no workers, then just point at where live progress is tracked).
  const nextAction = materialsBlocking
    ? "Issue required materials"
    : !hasAssignment
      ? "Assign workers"
      : activeSession
        ? "Monitor progress in Daily Activity"
        : "Review Job Card and confirm next step";

  return {
    id: wo.id,
    workOrderNumber: wo.work_order_number,
    assetLabel: wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null,
    issue: wo.operator_complaint || wo.description_of_work || "No issue description",
    status: wo.status,
    createdAtLabel: formatDateTimeLabel(wo.created_at),
    requestedByName: requester?.full_name ?? null,
    workTeam: wo.worker_type,
    assignmentStatusLabel,
    workersCount,
    materialsStatusLabel: materialsStatusLabel(materialsAvailability),
    attachmentsCount: wo._count.work_order_attachments,
    nextAction,
    detailHref: `/maintenance/work-orders/${wo.id}`,
  };
}
