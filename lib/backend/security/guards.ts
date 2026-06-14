import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { hasPermission } from "@/lib/security/permissions";
import type { PermissionKey } from "@/types/database";

export function assertBackendPermission(context: CurrentUserContext, permission: PermissionKey) {
  if (!hasPermission(context, permission)) {
    throw new AppError("You do not have permission to complete this action.", {
      code: "FORBIDDEN"
    });
  }
}

export function assertActiveUser(context: CurrentUserContext) {
  if (!context.profile.is_active) {
    throw new AppError("This user account is inactive.", {
      code: "FORBIDDEN"
    });
  }
}
