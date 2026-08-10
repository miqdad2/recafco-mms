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

// Unit 10G.8, Task 1/2: worker names grouped the same way the Internal Team
// roster form (components/work-orders/internal-team-roster-form.tsx) and
// backend (lib/backend/work-orders/worker-roster.ts) already label roles —
// "Supervisor" / "Technician" / "Helper/Labor" — so this popup uses the
// exact same terminology as the rest of the app. `legacy` covers Job Cards
// assigned before/without the Internal Team roster (freelancer, external
// company, or the older single-technician login assignment), only ever
// populated when the roster itself is empty (Task 2's stated priority).
export type JobCardSummaryWorkers = {
  supervisor: string[];
  technicians: string[];
  helpers: string[];
  legacy: string[];
};

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
  workers: JobCardSummaryWorkers;
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

  // Unit 10G.8, Task 2: worker names come from this same single Job Card
  // fetch (no per-row N+1) — the Internal Team roster joined to
  // worker_profiles for the name, plus the legacy work_order_assignments
  // table (freelancer/external company/single-technician-login assignment)
  // as a fallback only used when the roster itself is empty.
  const wo = await prisma.work_orders.findFirst({
    where: { id: workOrderId, deleted_at: null, AND: [visibilityFilter] },
    select: {
      id: true, work_order_number: true, status: true, created_at: true, created_by: true,
      operator_complaint: true, description_of_work: true, worker_type: true,
      assets: { select: { asset_name: true, plate_number: true } },
      work_order_worker_assignments: {
        where: { status: "active" },
        select: { worker_role: true, worker_profiles: { select: { name: true } } },
        orderBy: [{ worker_role: "asc" }, { assigned_at: "asc" }],
      },
      work_order_assignments: {
        select: {
          assignment_type: true,
          external_name: true,
          external_company: true,
          profiles: { select: { full_name: true } },
        },
        orderBy: { assigned_at: "desc" },
      },
      _count: { select: { work_order_attachments: true } },
    },
  });
  if (!wo) return null;

  const [requester, activeSession, fulfillment] = await Promise.all([
    wo.created_by ? prisma.profiles.findUnique({ where: { id: wo.created_by }, select: { full_name: true } }) : Promise.resolve(null),
    prisma.workOrderWorkSession.findFirst({ where: { work_order_id: wo.id, status: { in: ["Active", "Paused"] } }, select: { status: true } }),
    getMaterialFulfillmentForWorkOrder(prisma, wo.id),
  ]);

  // Unit 10G.8, Task 2: priority 1 — Internal Team roster (worker_profiles
  // names, grouped by worker_role exactly as worker-roster.ts assigns it).
  const roster = wo.work_order_worker_assignments;
  const supervisor = roster.filter((r) => r.worker_role === "Supervisor").map((r) => r.worker_profiles.name);
  const technicians = roster.filter((r) => r.worker_role === "Technician").map((r) => r.worker_profiles.name);
  const helpers = roster.filter((r) => r.worker_role === "Helper/Labor").map((r) => r.worker_profiles.name);

  // Priority 2 — legacy assignment (freelancer / external company / the
  // older single-technician login assignment), only when the roster above
  // is empty. Priority 3 ("Not assigned") falls out naturally when both are
  // empty — workersCount stays 0 and every group below stays [].
  const legacy: string[] =
    roster.length === 0
      ? wo.work_order_assignments
          .map((a) => {
            if (a.assignment_type === "FREELANCER") return a.external_name ? `${a.external_name} (Freelancer)` : null;
            if (a.assignment_type === "EXTERNAL_COMPANY") return a.external_company ? `${a.external_company} (External Company)` : null;
            return a.profiles?.full_name ? `${a.profiles.full_name} (Technician)` : null;
          })
          .filter((n): n is string => Boolean(n))
      : [];

  const workers: JobCardSummaryWorkers = { supervisor, technicians, helpers, legacy };
  const workersCount = roster.length > 0 ? roster.length : legacy.length;
  const hasAssignment = workersCount > 0;
  const assignmentStatusLabel = !hasAssignment
    ? "No workers assigned"
    : `${workersCount} worker${workersCount !== 1 ? "s" : ""} assigned${activeSession?.status === "Active" ? " · Working Now" : activeSession?.status === "Paused" ? " · Paused" : ""}`;

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
    workers,
    materialsStatusLabel: materialsStatusLabel(materialsAvailability),
    attachmentsCount: wo._count.work_order_attachments,
    nextAction,
    detailHref: `/maintenance/work-orders/${wo.id}`,
  };
}
