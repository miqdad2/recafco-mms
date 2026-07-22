import "server-only";

import type { Prisma } from "@prisma/client";

import type { CurrentUserContext } from "@/lib/auth/context";

// Work order statuses that are already fully resolved — no further action needed
export const TERMINAL_WO_STATUSES = ["Closed", "Cancelled"] as const;

// Stages a Supervisor must be able to see for assignment + verification.
// Maintenance Workflow Redesign Unit 9 Task 11: re-derived for the
// simplified 9-status Job Card model — the old statuses below matched zero
// live records, which meant a Supervisor with no department set (or working
// outside their own department) could never see a Job Card needing
// assignment. Legacy statuses are kept for any pre-Unit3 historical row.
const SUPERVISOR_STAGES = [
  "Approved",
  "Waiting Materials",
  "Partially Issued",
  "Materials Issued",
  "Assigned",
  "In Progress",
  // Legacy pre-Unit3 statuses — defensive fallback only.
  "Waiting for Parts",
  "Waiting for Purchase",
  "Parts Issued",
  "Completed by Technician",
] as const;

/**
 * Returns a Prisma WHERE fragment that limits work_orders to records the
 * context user is permitted to see based on their role, department, and
 * assignment.  Apply this to every query touching work_orders so that list
 * counts, KPI cards, and detail/print pages all enforce the same scope.
 *
 * Returns `{}` for full-access roles — do NOT short-circuit before calling.
 *
 * Non-negotiable guarantee (JobCard-Creation-Visibility-HardFix-01 Task 3):
 * a user can always see a Job Card they personally created, regardless of
 * role, department, team, assigned technician, or status — this wraps the
 * role-specific scope below in `OR created_by = me` for every role that
 * doesn't already have full access.
 */
export function getWorkOrderVisibilityFilter(
  context: CurrentUserContext
): Prisma.work_ordersWhereInput {
  const roleScope = getRoleScopeFilter(context);

  // {} already means "sees everything" — OR-ing would be a no-op, and for
  // every other role OR-ing in their own creations only ever widens scope,
  // never narrows it, so this is always safe to apply.
  if (Object.keys(roleScope).length === 0) return roleScope;
  return { OR: [roleScope, { created_by: context.userId }] };
}

function getRoleScopeFilter(
  context: CurrentUserContext
): Prisma.work_ordersWhereInput {
  const slug = context.role?.slug ?? "";
  const userId = context.userId;
  const deptId = context.department?.id ?? null;
  const perms = context.permissions;

  // ── Full access ───────────────────────────────────────────────────────────
  if (slug === "super_admin" || slug === "it_admin" || slug === "viewer_auditor") {
    return {};
  }

  // ── CEO / Management ──────────────────────────────────────────────────────
  // Sees high-priority active WOs, anything awaiting purchase, and any WO
  // that has a purchase request in CEO approval stage.
  if (slug === "ceo_management" || perms.includes("ceo.approve")) {
    return {
      OR: [
        {
          AND: [
            { priority: { in: ["High", "Urgent"] } },
            { status: { notIn: [...TERMINAL_WO_STATUSES] } },
          ],
        },
        { status: { in: ["Waiting for Purchase"] } },
        { purchase_requests: { some: { status: "Pending CEO Approval" } } },
      ],
    };
  }

  // ── Finance Manager ───────────────────────────────────────────────────────
  // Sees WOs in the purchase/finance pipeline so they can make cost decisions.
  if (slug === "finance_manager" || perms.includes("finance.approve")) {
    return {
      OR: [
        { status: { in: ["Waiting for Purchase"] } },
        {
          purchase_requests: {
            some: {
              status: {
                in: [
                  "Pending Finance Approval",
                  "Pending CEO Approval",
                  "Approved",
                  "Ordered",
                  "Received",
                ],
              },
            },
          },
        },
      ],
    };
  }

  // ── Purchase Officer ──────────────────────────────────────────────────────
  // Sees WOs that have an active (non-terminal) purchase request.
  if (slug === "purchase_officer" || perms.includes("purchase_requests.manage")) {
    return {
      OR: [
        { status: { in: ["Waiting for Purchase"] } },
        {
          purchase_requests: {
            some: {
              status: { notIn: ["Cancelled", "Rejected", "Draft"] },
            },
          },
        },
      ],
    };
  }

  // ── Store Keeper ──────────────────────────────────────────────────────────
  // Sees only WOs where materials may need Store action: from Manager
  // approval (so Store can see what's required) through fully issued
  // (Maintenance Workflow Redesign Unit 3 — simplified status model).
  //
  // Manager Dashboard Real Preview Loader Fix — root cause found via live
  // runtime debugging: Maintenance Manager also holds `store.issue` (granted
  // intentionally so Manager can send materials too — see
  // lib/backend/parts-requests/service.ts assertCanIssueMaterials), so this
  // permission-based fallback was matching Manager FIRST (this check runs
  // before the Maintenance Manager branch below) and silently downgrading
  // Manager's visibility to Store Keeper's narrow status-based scope. A real
  // Job Card Manager needed to preview — "Under Review", not in Store
  // Keeper's allowed list, and not created by that Manager — fell through
  // both OR branches and vanished, producing "Job Card not found" only for
  // Managers who also hold store.issue. `!perms.includes("work_orders.approve")`
  // excludes anyone who actually has Manager-level access, matching the same
  // exclusion pattern already used for Maintenance Supervisor below.
  if (
    slug === "store_keeper" ||
    (perms.includes("store.issue") && !perms.includes("work_orders.approve")) ||
    (perms.includes("parts_requests.issue") && !perms.includes("work_orders.approve"))
  ) {
    return {
      status: { in: ["Approved", "Waiting Materials", "Partially Issued", "Materials Issued"] },
    };
  }

  // ── Technician ────────────────────────────────────────────────────────────
  // Sees only WOs where they have a direct assignment record.
  if (slug === "technician") {
    return {
      work_order_assignments: { some: { technician_id: userId } },
    };
  }

  // ── Maintenance Engineer ──────────────────────────────────────────────────
  // Reviews every incoming Job Card (Under Review) and tracks work through to
  // close — same company-wide scope as Manager (Critical Workflow Bug Fix —
  // Engineer/Manager Visibility, Task 7). Checked by slug, before the
  // Maintenance Supervisor fallback below: Engineer's permission set
  // (work_orders.assign without work_orders.approve) would otherwise
  // accidentally match that permission-based heuristic and get routed into
  // Supervisor's narrower SUPERVISOR_STAGES scope — which excludes "Under
  // Review" entirely, hiding every Job Card Engineer is actually meant to
  // review. That was the root cause of Engineer never seeing a Data-Entry-
  // created "Under Review" Job Card.
  if (slug === "maintenance_engineer") {
    return {};
  }

  // ── Maintenance Supervisor ────────────────────────────────────────────────
  // Sees WOs assigned to them personally, plus all supervisor-stage WOs in
  // their department (or globally if no department is set).
  if (
    slug === "maintenance_supervisor" ||
    (perms.includes("work_orders.assign") && !perms.includes("work_orders.approve"))
  ) {
    const orConds: Prisma.work_ordersWhereInput[] = [
      { assigned_supervisor_id: userId },
    ];
    if (deptId) {
      orConds.push({
        AND: [
          { requested_by_department_id: deptId },
          { status: { in: [...SUPERVISOR_STAGES] } },
        ],
      });
    } else {
      // No department set — show all supervisor-stage WOs so they can be assigned
      orConds.push({ status: { in: [...SUPERVISOR_STAGES] } });
    }
    return { OR: orConds };
  }

  // ── Maintenance Manager ───────────────────────────────────────────────────
  // Sees all repair orders — responsible for reviewing, assigning, and closing
  // all maintenance work. A manager with no department still needs full access
  // to process the team's submissions.
  if (slug === "maintenance_manager" || perms.includes("work_orders.approve")) {
    return {};
  }

  // ── Maintenance Data Entry ────────────────────────────────────────────────
  // Sees only the work orders they personally created.
  if (
    slug === "maintenance_data_entry" ||
    (perms.includes("work_orders.manage") &&
      !perms.includes("work_orders.approve") &&
      !perms.includes("work_orders.assign"))
  ) {
    return { created_by: userId };
  }

  // ── Department Requester ──────────────────────────────────────────────────
  // Sees only work orders they personally created, regardless of which
  // department the WO belongs to or how far through the workflow it has
  // progressed (Purchase / Finance / CEO stages).  No department-wide access.
  if (slug === "department_requester") {
    return { created_by: userId };
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  // Unknown role — show only what the user created.  Principle of least privilege.
  return { created_by: userId };
}

/**
 * Short human-readable description of what the current user's visibility
 * scope covers.  Used in the page sub-heading.
 */
export function getRoleDescription(context: CurrentUserContext): string {
  switch (context.role?.slug) {
    case "super_admin":
    case "it_admin":
      return "All company Job Cards — full system view";
    case "ceo_management":
      return "High-priority Job Cards and items pending executive approval";
    case "finance_manager":
      return "Job Cards in the finance and purchase approval pipeline";
    case "purchase_officer":
      return "Job Cards with active purchase requests";
    case "store_keeper":
      return "Job Cards waiting for materials issue or store action";
    case "technician":
      return "My assigned jobs";
    case "maintenance_manager":
      return "All maintenance Job Cards — full management view";
    case "maintenance_engineer":
      return "All maintenance Job Cards — review and tracking view";
    case "maintenance_supervisor":
      return "Supervisor assignment and job verification queue";
    case "maintenance_data_entry":
      return "My submitted maintenance requests";
    case "department_requester":
      return "My submitted maintenance requests";
    case "viewer_auditor":
      return "Read-only view of all maintenance Job Cards";
    default:
      return "Job Cards visible to your role";
  }
}
