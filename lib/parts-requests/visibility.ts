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
 * Explicit role check (not a generic permission key) for who may record
 * materials received against a Materials Request — the single shared gate
 * for the "Receive Materials" action (creates the Offline Inventory Control
 * movement and, once fully received, marks the request Received).
 *
 * Simplified Workflow Correction Unit: Store is removed from the active
 * workflow — Data Entry AND Supervisor/Manager (`maintenance_manager`) both
 * need this action now, reversing an earlier decision that excluded Manager.
 * `parts_requests.issue`/`store.issue` permission holders are still allowed
 * too (backward compatible with any role/grant relying on the old
 * Store-issue permission), but the role-slug check is what the three active
 * roles (Data Entry, Manager, Super Admin) actually rely on. Viewer/Auditor
 * and Technician remain excluded. Shared between the server actions and the
 * list/detail pages so the UI and the enforcement never drift apart.
 */
export function canReceiveIssueMaterials(context: CurrentUserContext): boolean {
  return (
    context.role?.slug === "super_admin" ||
    context.role?.slug === "maintenance_data_entry" ||
    context.role?.slug === "maintenance_manager" ||
    context.permissions.includes("parts_requests.issue") ||
    context.permissions.includes("store.issue")
  );
}

/**
 * Who may create a Job Card Materials Request — the exact same check
 * duplicated inline as `requirePartsRequestCreator()` in app/actions/
 * phase4.ts and `assertCanCreatePartsRequest()` in lib/backend/parts-
 * requests/service.ts (both left as-is, out of scope to refactor here).
 * Job Card Materials Request UX and Existing Inventory Selection Fix adds
 * this exported copy so its own new Requested Materials autocomplete/cost-
 * permission actions (app/actions/offline-inventory.ts) can gate on the
 * wizard's real creator set — including Technician, who has
 * parts_requests.create but not work_orders.manage — rather than reusing
 * the New Job Card wizard's own work_orders.manage-only search action,
 * which would silently return nothing for a Technician typing a material
 * name.
 */
export function canCreatePartsRequest(context: CurrentUserContext): boolean {
  return (
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.create") ||
    context.permissions.includes("work_orders.manage")
  );
}
