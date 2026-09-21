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
