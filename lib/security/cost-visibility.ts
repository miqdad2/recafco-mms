import type { CurrentUserContext } from "@/lib/auth/context";
import { canViewCosts } from "@/lib/security/permissions";

export function stripCostFields<T extends Record<string, unknown>>(context: CurrentUserContext, row: T) {
  if (canViewCosts(context)) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !/(cost|price|amount|total|rate)/i.test(key))) as Partial<T>;
}

export function sanitizeNotificationMetadata(context: CurrentUserContext, metadata: Record<string, unknown>) {
  if (canViewCosts(context)) return metadata;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !/(cost|price|amount|total|rate|threshold)/i.test(key)));
}
