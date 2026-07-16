import "server-only";

import type { Prisma } from "@prisma/client";

import type { CurrentUserContext } from "@/lib/auth/context";

/**
 * Returns a Prisma WHERE fragment that limits parts_requests to records the
 * context user is permitted to see. Apply this to every query touching
 * parts_requests so list, detail, and preview lookups all enforce the same
 * scope.
 *
 * Broad roles (store issue, work order approval/management, super admin) see
 * everything. Everyone else — including the creator/requester on any other
 * role — is guaranteed to see requests they personally created or requested,
 * regardless of department or team scope (MaterialsRequest-CreateSuccess-UX-01
 * Task 5). Returns `{}` for full-access roles — do NOT short-circuit before
 * calling.
 */
export function getPartsRequestVisibilityFilter(
  context: CurrentUserContext
): Prisma.parts_requestsWhereInput {
  const canSeeAll =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("store.issue") ||
    context.permissions.includes("work_orders.approve") ||
    context.permissions.includes("work_orders.manage");

  if (canSeeAll) return {};

  return {
    OR: [{ created_by: context.userId }, { requested_by: context.userId }],
  };
}

/**
 * Explicit role check (not a generic permission key) for exactly the three
 * roles that may receive/issue materials against a Materials Request
 * (MaterialsRequest-DataEntryReceiveIssue-01 Task 1) — deliberately NOT the
 * broader `store.issue` permission, which would also unlock the rest of
 * Offline Inventory Control (Add Opening Stock, Import, etc.) for Data Entry,
 * well beyond what this feature asks for. Viewer/Auditor and Technician are
 * excluded unless a future phase explicitly grants them a qualifying
 * permission. Shared between the server actions and the list/detail pages so
 * the UI and the enforcement never drift apart.
 */
export function canReceiveIssueMaterials(context: CurrentUserContext): boolean {
  return (
    context.role?.slug === "super_admin" ||
    context.role?.slug === "maintenance_manager" ||
    context.role?.slug === "maintenance_data_entry"
  );
}
