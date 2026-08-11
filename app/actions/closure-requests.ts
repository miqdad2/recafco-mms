"use server";

import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { canViewCosts as canViewCostsForContext } from "@/lib/security/permissions";
import { canViewEntityFile } from "@/lib/security/file-access";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { getMaterialFulfillmentForWorkOrder, type MaterialFulfillment } from "@/lib/work-orders/material-fulfillment";
import { getWorkOrderLaborSummariesBulk } from "@/lib/work-orders/work-session-totals";

// Closure Requests Review Popup Unit 10G.2, Task 10.
//
// Pattern B — same convention as getClosedJobCardDetailAction
// (app/actions/closed-job-cards.ts) and getJobCardMaterialsModalDataAction
// (app/actions/daily-activity-materials.ts): the Closure Requests LIST
// (app/(dashboard)/dashboard/page.tsx) only carries the light summary a
// compact row needs; this action fetches the full worker/materials/
// attachments/note breakdown for exactly ONE Job Card, only when the
// Manager clicks "Review Closure" — never for the whole list at once.
// Read-only reporting only — no write path here touches closure, materials,
// or work-session logic.

function assertIsManagerRole(context: CurrentUserContext) {
  if (context.role?.slug !== "super_admin" && context.role?.slug !== "maintenance_manager") {
    throw new Error("Only a Manager can review a closure request.");
  }
}

// Same 3-state wording as getClosedJobCardsListAction/getClosedJobCardDetailAction
// (app/actions/closed-job-cards.ts) — kept as its own local copy rather than
// exported/shared, matching this codebase's existing convention of small
// per-file label-mapping helpers (e.g. materialRowLabel in
// components/dashboard/closure-requests-modal.tsx).
//
// Unit 10G.14: computed directly from the raw required/issued/remaining
// numbers rather than MaterialFulfillment["status"] — that status is now a
// pure availability read (ready_to_issue/partial_available/needs_receiving),
// answering "what should happen next," while this 3-state label answers a
// different question this Closure Review popup actually needs — "how much
// of this line has been issued to the Job Card so far" — which stays
// meaningful regardless of current Offline Inventory stock.
function materialsStatusLabel(f: MaterialFulfillment): "Fully Issued" | "Partially Issued" | "Not Issued" {
  if (f.remaining_qty <= 1e-9) return "Fully Issued";
  if (f.issued_qty > 1e-9) return "Partially Issued";
  return "Not Issued";
}

// Task 2 — "closure_requested_at - created_at", displayed as "Same day" /
// "1 day" / "3 days" / "3 days 4 hours".
function daysTakenLabel(createdAt: Date, closureRequestedAt: Date): string {
  const ms = Math.max(closureRequestedAt.getTime() - createdAt.getTime(), 0);
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const sameCalendarDay =
    createdAt.getFullYear() === closureRequestedAt.getFullYear() &&
    createdAt.getMonth() === closureRequestedAt.getMonth() &&
    createdAt.getDate() === closureRequestedAt.getDate();
  if (sameCalendarDay) return "Same day";
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  if (hours === 0) return `${days} day${days === 1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatDateTimeLabel(v: Date): string {
  return v.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export type ClosureReviewWorker = {
  workerAssignmentId: string;
  name: string;
  role: string;
  skillCategory: string | null;
  hours: number;
  hourlyRate: number | null;
  totalPay: number | null;
  sessionsCount: number;
  status: string;
  // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 8: this
  // worker's own estimate (WorkOrderWorkerAssignment.estimated_hours), if
  // set — visible regardless of canViewCosts (hours only, not gated like
  // hourlyRate/totalPay above).
  estimatedHours: number | null;
};

export type ClosureReviewMaterial = {
  description: string;
  requiredQty: number;
  issuedQty: number;
  remainingQty: number;
  unit: string;
  status: "Fully Issued" | "Partially Issued" | "Not Issued";
};

export type ClosureReviewAttachment = {
  id: string;
  type: string;
  fileName: string;
  uploadedByName: string | null;
  uploadedAtLabel: string;
  viewUrl: string | null;
};

export type ClosureReviewDetail = {
  id: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string;
  status: string;
  createdAtLabel: string;
  closureRequestedAtLabel: string | null;
  daysTakenLabel: string | null;
  requestedByName: string | null;
  workers: ClosureReviewWorker[];
  workersCount: number;
  totalHours: number;
  totalAmount: number | null;
  // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 8:
  // work_orders.estimated_labor_hours — visible regardless of canViewCosts.
  estimatedHours: number | null;
  materials: ClosureReviewMaterial[];
  materialsFullyIssued: boolean;
  attachments: ClosureReviewAttachment[];
  note: string | null;
  canViewCosts: boolean;
  detailHref: string;
};

export async function getClosureReviewDetailAction(workOrderId: string): Promise<ClosureReviewDetail | null> {
  const context = await requireUser();
  assertIsManagerRole(context);
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const canViewCosts = canViewCostsForContext(context);

  const wo = await prisma.work_orders.findFirst({
    where: { id: workOrderId, deleted_at: null, AND: [visibilityFilter] },
    select: {
      id: true,
      work_order_number: true,
      status: true,
      created_at: true,
      operator_complaint: true,
      description_of_work: true,
      estimated_labor_hours: true,
      assets: { select: { asset_name: true, plate_number: true } },
      approvals: {
        where: { status: "Closure Requested" },
        orderBy: { decided_at: "desc" },
        take: 1,
        select: { decided_at: true, decided_by: true, comments: true },
      },
      work_order_attachments: {
        select: { id: true, attachment_type: true, file_name: true, file_path: true, uploaded_by: true, created_at: true },
        orderBy: { created_at: "desc" },
      },
    },
  });
  if (!wo) return null;

  const [laborMap, fulfillment, canViewFiles] = await Promise.all([
    // Task 3 — the bulk variant (single-element array) is used deliberately
    // even for one Job Card: it's the only function that also carries
    // skill_category/sessions_count (see lib/work-orders/work-session-totals.ts) —
    // getWorkOrderLaborSummary (the plain single-Job-Card version) does not
    // populate those two fields. Same query count either way.
    getWorkOrderLaborSummariesBulk(prisma, [workOrderId]),
    getMaterialFulfillmentForWorkOrder(prisma, workOrderId),
    canViewEntityFile(context, "work-order-files", workOrderId),
  ]);
  const laborSummary = laborMap.get(workOrderId) ?? { workers: [], total_minutes: 0, total_hours: 0, total_amount: 0, has_active_session: false, today_minutes: 0, today_amount: 0, week_minutes: 0, week_amount: 0, month_minutes: 0, month_amount: 0 };

  const approval = wo.approvals[0] ?? null;
  const profileIds = [
    approval?.decided_by,
    ...wo.work_order_attachments.map((a) => a.uploaded_by),
  ].filter((id): id is string => Boolean(id));
  const profiles = profileIds.length
    ? await prisma.profiles.findMany({ where: { id: { in: [...new Set(profileIds)] } }, select: { id: true, full_name: true } })
    : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));

  const attachments: ClosureReviewAttachment[] = await Promise.all(
    wo.work_order_attachments.map(async (a) => ({
      id: a.id,
      type: a.attachment_type,
      fileName: a.file_name,
      uploadedByName: a.uploaded_by ? nameById.get(a.uploaded_by) ?? null : null,
      uploadedAtLabel: formatDateTimeLabel(a.created_at),
      viewUrl: canViewFiles ? await createSignedFileUrl("work-order-files", a.file_path) : null,
    }))
  );

  const materials: ClosureReviewMaterial[] = fulfillment.map((f) => ({
    description: f.description,
    requiredQty: f.required_qty,
    issuedQty: f.issued_qty,
    remainingQty: f.remaining_qty,
    unit: f.unit,
    status: materialsStatusLabel(f),
  }));

  return {
    id: wo.id,
    workOrderNumber: wo.work_order_number,
    assetLabel: wo.assets ? `${wo.assets.asset_name}${wo.assets.plate_number ? ` (${wo.assets.plate_number})` : ""}` : null,
    issue: wo.operator_complaint || wo.description_of_work || "No issue description",
    status: wo.status,
    createdAtLabel: formatDateTimeLabel(wo.created_at),
    closureRequestedAtLabel: approval ? formatDateTimeLabel(approval.decided_at) : null,
    daysTakenLabel: approval ? daysTakenLabel(wo.created_at, approval.decided_at) : null,
    // Task 2 — the actual requester is who submitted THIS "Closure Requested"
    // approval row (decided_by, stamped by requestJobCardClosure with the
    // caller's own userId) — more precise than work_orders.created_by (who
    // created the Job Card, which can be a different person/time and is
    // what the Closure Requests LIST still uses for its own "Requested by"
    // — left as-is there, out of scope for this unit).
    requestedByName: approval?.decided_by ? nameById.get(approval.decided_by) ?? null : null,
    workers: laborSummary.workers.map((w) => ({
      workerAssignmentId: w.worker_assignment_id,
      name: w.worker_name,
      role: w.worker_role,
      skillCategory: w.skill_category ?? null,
      hours: w.total_hours,
      hourlyRate: canViewCosts ? w.hourly_rate_snapshot : null,
      totalPay: canViewCosts ? w.total_amount : null,
      sessionsCount: w.sessions_count ?? 0,
      status: w.status,
      estimatedHours: w.estimated_hours,
    })),
    workersCount: laborSummary.workers.length,
    totalHours: laborSummary.total_hours,
    totalAmount: canViewCosts ? laborSummary.total_amount : null,
    estimatedHours: wo.estimated_labor_hours !== null ? Number(wo.estimated_labor_hours) : null,
    materials,
    materialsFullyIssued: materials.length > 0 && materials.every((m) => m.status === "Fully Issued"),
    attachments,
    note: approval?.comments ?? null,
    canViewCosts,
    detailHref: `/maintenance/work-orders/${wo.id}`,
  };
}
