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

/**
 * Maintenance Workflow Redesign Unit 6 — recipient dedup + actor exclusion.
 * `resolveRecipientsForEvent` (lib/notifications/recipients.ts) already
 * dedupes direct + role-resolved recipients within a single notifyByEvent
 * call via a Map keyed by userId; this helper does the same dedup up front
 * for explicit recipientUserIds lists built from multiple sources (creator +
 * several role lookups), and drops the acting user — who usually doesn't
 * need to be told about their own action — unless explicitly opted back in.
 */
export function dedupeRecipients(ids: (string | null | undefined)[], excludeActorId?: string | null): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id && id !== excludeActorId) seen.add(id);
  }
  return [...seen];
}
