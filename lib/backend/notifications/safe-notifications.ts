import "server-only";

import { safeSideEffect } from "@/lib/errors/safe-action";
import { notifyByEvent } from "@/lib/notifications/service";
import type { NotifyByEventInput } from "@/lib/notifications/types";

export async function notifyWorkflowEvent(input: NotifyByEventInput) {
  await safeSideEffect(
    "backend.notifications.workflow",
    () => notifyByEvent(input),
    {
      eventKey: input.eventKey,
      entityType: input.entityType,
      entityId: input.entityId ?? null
    }
  );
}
