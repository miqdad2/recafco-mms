import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

// ── Event type constants ──────────────────────────────────────────────────────

export const REALTIME_EVENTS = {
  WORK_ORDER_CREATED:   "work_order.created",
  WORK_ORDER_SAVED:     "work_order.saved",
  WORK_ORDER_SUBMITTED: "work_order.submitted",
  WORK_ORDER_APPROVED:  "work_order.approved",
  WORK_ORDER_REJECTED:  "work_order.rejected",
  WORK_ORDER_ASSIGNED:  "work_order.assigned",
  WORK_ORDER_COMPLETED: "work_order.completed",
  USER_CREATED:         "user.created",
  USER_UPDATED:         "user.updated",
  BACKUP_UPDATED:       "backup.updated",
  NOTIFICATION_UPDATED: "notification.updated",
} as const;

export type RealtimeEventType = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

// ── Input ─────────────────────────────────────────────────────────────────────

export type RealtimeEventInput = {
  eventType:        RealtimeEventType;
  entityType:       string;
  entityId?:        string | null;
  actorProfileId?:  string | null;
  targetProfileId?: string | null;
  departmentId?:    string | null;
  scope?:           string | null;
  /** Safe, non-sensitive context fields only. Costs/prices are stripped. */
  payload?:         Record<string, unknown>;
};

// ── Payload sanitization ──────────────────────────────────────────────────────
//
// Never include cost, price, or credential data in realtime events.
// Any connected client — including unauthenticated broadcast receivers in
// a future Socket.IO upgrade — could read these fields.

const BLOCKED_KEYS = new Set([
  "password",
  "password_hash",
  "token",
  "secret",
  "key",
  "cost",
  "price",
  "amount",
  "total",
  "budget",
  "unit_price",
  "rate",
  "total_cost",
  "total_labor_cost",
  "total_material_cost",
  "total_work_order_cost",
  "estimated_total",
  "ceo_approval_threshold",
]);

function sanitizePayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
    // Only allow scalar-safe values; drop nested objects that may carry costs.
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number") {
      // Allow numeric fields that are safe (e.g. counts, statuses).
      out[key] = value;
    }
  }
  return out;
}

// ── emitRealtimeEvent ─────────────────────────────────────────────────────────
//
// Inserts a row into realtime_events. Never throws — errors are written to
// system_error_logs so the calling action is never disrupted.
//
// Phase 2 note: a Socket.IO server-side listener will tail this table and
// broadcast rows to subscribed clients. No application code changes will be
// needed in the actions at that point.

export async function emitRealtimeEvent(input: RealtimeEventInput): Promise<void> {
  try {
    const safePayload = sanitizePayload(input.payload ?? {});

    await prisma.realtime_events.create({
      data: {
        event_type:        input.eventType,
        entity_type:       input.entityType,
        entity_id:         input.entityId    ?? null,
        actor_profile_id:  input.actorProfileId  ?? null,
        target_profile_id: input.targetProfileId ?? null,
        department_id:     input.departmentId    ?? null,
        scope:             input.scope      ?? null,
        payload:           safePayload as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Attempt to write the failure to system_error_logs.
    try {
      await prisma.system_error_logs.create({
        data: {
          severity:    "warning",
          source:      "realtime.emitRealtimeEvent",
          message:     (err instanceof Error ? err.message : String(err)).slice(0, 1000),
          stack:       err instanceof Error ? (err.stack?.slice(0, 4000) ?? null) : null,
          entity_type: input.entityType,
          entity_id:   input.entityId ?? null,
          metadata:    { event_type: input.eventType } as Prisma.InputJsonValue,
        },
      });
    } catch {
      if (process.env.NODE_ENV === "development") {
        console.error("[emitRealtimeEvent] Failed to emit and failed to log error:", err);
      }
    }
  }
}
