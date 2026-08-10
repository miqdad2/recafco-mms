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
