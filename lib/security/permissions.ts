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
