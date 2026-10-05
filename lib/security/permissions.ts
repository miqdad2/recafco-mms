import type { CurrentUserContext } from "@/lib/auth/context";
import type { PermissionKey } from "@/types/database";

export function hasPermission(context: CurrentUserContext, permission: PermissionKey | string) {
  return context.role?.slug === "super_admin" || context.permissions.includes(permission as PermissionKey);
}

export function hasAnyPermission(context: CurrentUserContext, permissions: Array<PermissionKey | string>) {
  return context.role?.slug === "super_admin" || permissions.some((permission) => context.permissions.includes(permission as PermissionKey));
}

export function canViewCosts(context: CurrentUserContext) {
  return hasPermission(context, "costs.view") || context.profile.can_view_costs;
}

// Data Entry Material Request Price Entry Alignment — who may enter and see
// the ESTIMATED price on a Materials Request line (General Inventory /
// Stock Request and Job Card Materials Request: the request forms, their
// detail views and the submitted popup). Deliberately separate from
// canViewCosts above: that one also unlocks labor cost, worker rates,
// indirect cost, final Job Card cost and inventory unit cost, none of which
// this grants. Use this ONLY for material request price fields.
export function canEnterMaterialRequestPrice(context: CurrentUserContext) {
  const slug = context.role?.slug;
  return (
    slug === "super_admin" ||
    slug === "maintenance_manager" ||
    slug === "maintenance_data_entry" ||
    // Anyone who already saw request pricing through cost visibility keeps it.
    canViewCosts(context)
  );
}

// Worker Rate Visibility and Data Entry Lockdown Unit 10F.4: the "Manager or
// Super Admin only" role check was already duplicated inline in four places
// (lib/backend/work-orders/work-sessions.ts, lib/backend/work-orders/service.ts,
// app/(dashboard)/maintenance/assignments/page.tsx twice) before this unit
// added a fifth use (worker profile edit/deactivate lockdown) — centralized
// here instead of pasting a fifth copy. Existing inline copies were left
// alone (out of scope, no behavior change needed there); new/changed call
// sites in this unit use this export.
export function isManagerRole(context: CurrentUserContext) {
  return context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
}

// Job Card Level Indirect Cost Correction Unit 10G.72B, Task 2 — "Only
// Super Admin/System Admin/Maintenance Manager with settings/cost
// permission can edit" the global Job Card Indirect Cost setting. Super
// Admin always bypasses (matches every other role-bypass in this app);
// IT Admin ("System Admin") and Maintenance Manager additionally need cost
// visibility (canViewCosts) — a Manager whose profile isn't cost-permitted
// cannot reach this setting either, same spirit as every other cost-gated
// surface in this app. Deliberately a plain role/permission check, not a
// new `permissions` table row — this setting has its own small, dedicated
// settings sub-page (app/(dashboard)/admin/settings/job-card-cost/page.tsx),
// reachable independently of the broader admin.settings.manage-gated main
// Settings page (which Maintenance Manager does not have access to), same
// established pattern as admin/settings/asset-categories's own narrower
// assets.manage gate.
export function canManageJobCardIndirectCostSetting(context: CurrentUserContext): boolean {
  if (context.role?.slug === "super_admin") return true;
  if (context.role?.slug === "it_admin" || context.role?.slug === "maintenance_manager") {
    return canViewCosts(context);
  }
  return false;
}

// Assets & Equipment Data Entry View-Only Access — the Assets module's own
// permission vocabulary. Maintenance Data Entry's role still holds
// assets.manage / work_orders.manage (other modules rely on them), so the
// raw permission is not enough here: inside Assets & Equipment that role is
// view-only, and every page, button and server action asks these helpers
// instead. Super Admin always passes; Manager and the other roles keep
// exactly what their permissions already gave them.
export const ASSET_MANAGE_DENIED_MESSAGE = "You do not have permission to manage assets.";

function isAssetViewOnlyRole(context: CurrentUserContext) {
  return context.role?.slug === "maintenance_data_entry";
}

export function canViewAssets(context: CurrentUserContext): boolean {
  return context.role?.slug === "super_admin" || context.permissions.includes("assets.view");
}

// Create / edit assets, manage categories, upload asset documents.
export function canManageAssets(context: CurrentUserContext): boolean {
  if (context.role?.slug === "super_admin") return true;
  if (isAssetViewOnlyRole(context)) return false;
  return context.permissions.includes("assets.manage");
}

// Excel import ("Add these assets"). Replacing the whole register stays
// Super Admin only, checked in replaceAssetRegisterAction itself.
export function canImportAssets(context: CurrentUserContext): boolean {
  return canManageAssets(context);
}

// Send to Site / Receive Back.
export function canMoveAssets(context: CurrentUserContext): boolean {
  return canManageAssets(context);
}

// "Create Job Card" from inside Assets & Equipment. Data Entry still
// creates Job Cards from the Job Cards module — only this entry point is off.
export function canCreateJobCardFromAsset(context: CurrentUserContext): boolean {
  if (context.role?.slug === "super_admin") return true;
  if (isAssetViewOnlyRole(context)) return false;
  return context.permissions.includes("work_orders.manage");
}

// Asset detail / history print.
export function canPrintAssets(context: CurrentUserContext): boolean {
  return canViewAssets(context) && !isAssetViewOnlyRole(context);
}

// Site Locations (asset_locations) — who may add / edit / deactivate / delete the
// approved Send to Site locations: Super Admin and Maintenance Manager
// only. Deliberately a role check, not assets.manage: Data Entry (view-only
// in Assets) and Viewer/Auditor must never reach it.
export const ASSET_LOCATION_DENIED_MESSAGE = "You do not have permission to manage site locations.";

export function canManageAssetLocations(context: CurrentUserContext): boolean {
  return isManagerRole(context);
}
