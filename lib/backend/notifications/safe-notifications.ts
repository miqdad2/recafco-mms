import "server-only";

import { safeSideEffect } from "@/lib/errors/safe-action";
import { logSystemError } from "@/lib/errors/logging";
import { notifyByEvent } from "@/lib/notifications/service";
import type { NotifyByEventInput } from "@/lib/notifications/types";

/**
 * Recipients are looked up after the main write has committed. A database
 * hiccup here must not turn that saved write into an error for the user —
 * who would then retry an action that already happened ("already
 * requested", a second timer click) — so it is logged and nobody is
 * notified, like any other notification failure (CLAUDE.md invariant 3).
 */
export async function resolveRecipientsSafely(source: string, lookup: () => Promise<string[]>): Promise<string[]> {
  try {
    return await lookup();
  } catch (error) {
    await logSystemError({
      severity: "error",
      source,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      stack: error instanceof Error ? (error.stack ?? null) : null,
    }).catch(() => undefined);
    return [];
  }
}

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
