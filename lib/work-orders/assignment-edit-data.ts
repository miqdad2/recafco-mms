import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { ACTIVE_MATERIALS_REQUEST_STATUSES } from "@/lib/backend/parts-requests/repository";
import { getPendingClarificationForWorkOrder } from "@/lib/backend/workflows/queries";
import { getActiveWorkerProfilesForAssignment } from "@/lib/backend/workers/service";
import { ON_TEAM_ASSIGNMENT_STATUSES } from "@/lib/backend/workers/constants";
import { prisma } from "@/lib/db/prisma";
import { canViewCosts as canViewCostsFor } from "@/lib/security/permissions";
import { assignmentGates, rosterLockReason, type EditAssignmentData } from "@/lib/work-orders/assignment-edit";
import { toIsoDateOnly } from "@/lib/work-orders/job-card-edit";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { getWorkOrderLaborSummary } from "@/lib/work-orders/work-session-totals";

// Everything the Edit Assignment popup needs, for the Job Card page and Daily
// Activity alike, so the two can never differ. Null when this viewer cannot
// see the Job Card or cannot change its assignment right now.
export async function getEditAssignmentData(context: CurrentUserContext, workOrderId: string): Promise<EditAssignmentData | null> {
  const wo = await prisma.work_orders.findFirst({
    where: { AND: [{ id: workOrderId }, { deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
    select: {
      id: true,
      status: true,
      parts_requests: { select: { status: true } },
      work_order_assignments: { include: { profiles: { select: { full_name: true } } }, orderBy: { assigned_at: "asc" } },
      work_order_worker_assignments: {
        where: { status: { in: ON_TEAM_ASSIGNMENT_STATUSES } },
        include: { worker_profiles: { select: { name: true } } },
        orderBy: [{ worker_role: "asc" }, { assigned_at: "asc" }],
      },
    },
  });
  if (!wo) return null;

  const pendingClarification = await getPendingClarificationForWorkOrder(wo.id);
  const { canAssign, canManageRoster } = assignmentGates(context, wo.status, {
    hasPendingCorrection: pendingClarification !== null,
    hasActiveMaterialsRequest: wo.parts_requests.some((r) => (ACTIVE_MATERIALS_REQUEST_STATUSES as readonly string[]).includes(r.status)),
  });
  if (!canAssign && !canManageRoster) return null;

  const [activeWorkers, laborSummary] = await Promise.all([getActiveWorkerProfilesForAssignment(), getWorkOrderLaborSummary(prisma, wo.id)]);
  const canViewCosts = canViewCostsFor(context);
  const primary = wo.work_order_assignments[0] ?? null;

  return {
    workOrderId: wo.id,
    status: wo.status,
    canViewCosts,
    canManageRoster,
    canAssign,
    // Only what the popup shows; the rate only reaches viewers who may see costs.
    workers: activeWorkers.map((w) => ({
      id: w.id,
      name: w.name,
      worker_type: w.worker_type,
      is_active: w.is_active,
      hourly_rate: canViewCosts ? w.hourly_rate : null,
    })),
    roster: wo.work_order_worker_assignments.map((r) => {
      const labor = laborSummary.workers.find((w) => w.worker_assignment_id === r.id);
      return {
        worker_id: r.worker_id,
        worker_role: r.worker_role,
        name: r.worker_profiles.name,
        notes: r.notes,
        lock: rosterLockReason(r.status, labor?.status ?? "Not Started", labor?.total_minutes ?? 0),
        // Resubmitted unchanged, so a roster edit never wipes an estimate.
        estimated_hours: r.estimated_hours !== null ? Number(r.estimated_hours) : null,
      };
    }),
    current: primary
      ? {
          type: primary.assignment_type,
          technicianId: primary.technician_id,
          technicianName: primary.profiles?.full_name ?? null,
          externalName: primary.external_name,
          externalCompany: primary.external_company,
          contactPerson: primary.external_contact_person,
          phone: primary.external_phone,
          trade: primary.external_trade,
          visitDate: toIsoDateOnly(primary.external_expected_visit_date),
          notes: primary.notes,
          // Cost field: the amount itself only reaches viewers who may see costs.
          agreedAmount: canViewCosts && primary.agreed_amount !== null ? Number(primary.agreed_amount) : null,
          hasAgreedAmount: primary.agreed_amount !== null,
        }
      : null,
  };
}
