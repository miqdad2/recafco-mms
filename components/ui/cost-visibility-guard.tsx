import type { CurrentUserContext } from "@/lib/auth/context";

export function canViewCosts(context: CurrentUserContext) {
  return context.role?.slug === "super_admin" || context.permissions.includes("costs.view");
}

export function CostVisibilityGuard({
  context,
  children,
  fallback = "Restricted"
}: {
  context: CurrentUserContext;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return canViewCosts(context) ? children : <span className="text-[#4B5563]">{fallback}</span>;
}
