import "server-only";

import type { Prisma } from "@prisma/client";

import type { CurrentUserContext } from "@/lib/auth/context";

// Work order statuses that are already fully resolved — no further action needed
export const TERMINAL_WO_STATUSES = ["Closed", "Cancelled"] as const;

// Stages a Supervisor must be able to see for assignment + verification
const SUPERVISOR_STAGES = [
  "Approved",
  "Assigned",
  "In Progress",
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
 */
export function getWorkOrderVisibilityFilter(
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
  // Sees only WOs that are actively waiting for store or have been issued.
  if (slug === "store_keeper" || perms.includes("store.issue")) {
    return {
      status: { in: ["Waiting for Parts", "Parts Issued"] },
    };
  }

  // ── Technician ────────────────────────────────────────────────────────────
  // Sees only WOs where they have a direct assignment record.
  if (slug === "technician") {
    return {
      work_order_assignments: { some: { technician_id: userId } },
    };
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
  // Sees work orders created within their own department.
  // "Routed to department for approval" is scoped by requested_by_department_id
  // because the schema has no separate routing/approval-department field.
  // Global pending-approval visibility is intentionally NOT granted here —
  // only Super Admin and IT Admin may see all departments' queues.
  if (slug === "maintenance_manager" || perms.includes("work_orders.approve")) {
    if (deptId) {
      return { requested_by_department_id: deptId };
    }
    // No department assigned — apply least-privilege fallback.
    // An admin should assign a department to this profile.
    return { created_by: userId };
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
      return "All company maintenance work orders — full system view";
    case "ceo_management":
      return "High-priority work orders and items pending executive approval";
    case "finance_manager":
      return "Work orders in the finance and purchase approval pipeline";
    case "purchase_officer":
      return "Work orders with active purchase requests";
    case "store_keeper":
      return "Work orders waiting for parts issue or store action";
    case "technician":
      return "My assigned jobs";
    case "maintenance_manager":
      return "Work orders from your department";
    case "maintenance_supervisor":
      return "Supervisor assignment and job verification queue";
    case "maintenance_data_entry":
      return "My submitted maintenance requests";
    case "department_requester":
      return "My submitted maintenance requests";
    case "viewer_auditor":
      return "Read-only view of all maintenance work orders";
    default:
      return "Work orders visible to your role";
  }
}
