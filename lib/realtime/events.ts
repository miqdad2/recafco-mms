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

  // Users Page Monitoring Accuracy and Real-Time Unit Task 8: login/session
  // and admin-account-management events, all under the same "user." prefix
  // the Users page already watches (<RealtimeRefresh watch={["user."]} />)
  // — no new subscription needed on that page. USER_ACCOUNT_UNLOCKED is not
  // in the task's literal event list but is added for symmetry with
  // USER_ACCOUNT_LOCKED so the Locked Accounts KPI/badge also updates live
  // when an admin unlocks an account, not only when one locks.
  USER_LOGIN_SUCCESS:          "user.login_success",
  USER_LOGIN_FAILED:           "user.login_failed",
  USER_ACCOUNT_LOCKED:         "user.account_locked",
  USER_ACCOUNT_UNLOCKED:       "user.account_unlocked",
  USER_LOGOUT:                 "user.logout",
  USER_ROLE_CHANGED:           "user.role_changed",
  USER_ARCHIVED:               "user.archived",
  USER_RESTORED:               "user.restored",
  USER_PASSWORD_RESET:         "user.password_reset",
  USER_PASSWORD_CHANGE_FORCED: "user.password_change_forced",
  // Admin Delete User Option Unit: fired after a permanent delete commits.
  // Still under "user." so the Users page's existing watch picks it up.
  USER_DELETED:                "user.deleted",

  BACKUP_UPDATED:       "backup.updated",
  NOTIFICATION_UPDATED: "notification.updated",

  // Enterprise Real-Time Update Foundation Unit Task 2: "job_card.*" is the
  // user-facing vocabulary this unit's client hook categorizes by (see
  // lib/realtime/client-events.ts isJobCardEvent, which also matches the
  // legacy "work_order.*" keys above for backward compatibility — nothing
  // that already calls emitRealtimeEvent with a WORK_ORDER_* key needed to
  // change).
  JOB_CARD_CREATED:            "job_card.created",
  JOB_CARD_UPDATED:            "job_card.updated",
  JOB_CARD_SUBMITTED:          "job_card.submitted",
  JOB_CARD_REVIEWED:           "job_card.reviewed",
  JOB_CARD_CORRECTION_REQUESTED: "job_card.correction_requested",
  JOB_CARD_CORRECTION_RESPONDED: "job_card.correction_responded",
  JOB_CARD_APPROVED:           "job_card.approved",
  JOB_CARD_ASSIGNED:           "job_card.assigned",
  JOB_CARD_IN_PROGRESS:        "job_card.in_progress",
  // Approval Workflow Unit 4 — Closure Approval Only: Data Entry starting a
  // Job Card directly (Created -> Approved/"Active", no Manager approval
  // step) and requesting closure (-> "Closure Requested") are each their own
  // event now — both still match every existing page's "job_card." prefix
  // watch, so no RealtimeRefresh watch list needed to change (Unit 2).
  JOB_CARD_STARTED:            "job_card.started",
  JOB_CARD_CLOSURE_REQUESTED:  "job_card.closure_requested",
  JOB_CARD_CLOSED:             "job_card.closed",
  // Work Assignment and Worker Profiles Foundation Unit 7: the new Internal
  // Team labor roster (Supervisor/Technician/Helper via worker_profiles) is
  // a separate save path from the existing JOB_CARD_ASSIGNED (technician/
  // freelancer/company) — still matches every page's "job_card." prefix
  // watch, so no RealtimeRefresh watch list needed to change (Unit 2).
  JOB_CARD_ASSIGNMENT_UPDATED: "job_card.assignment_updated",
  // Work Session Time Tracking and Labor Cost Calculation Unit 8. Also under
  // "job_card." — no watch list changes needed anywhere.
  JOB_CARD_WORK_STARTED:      "job_card.work_started",
  JOB_CARD_WORK_PAUSED:       "job_card.work_paused",
  JOB_CARD_WORK_STOPPED:      "job_card.work_stopped",
  JOB_CARD_WORK_TIME_UPDATED: "job_card.work_time_updated",
  MATERIALS_REQUEST_CREATED:   "materials_request.created",
  MATERIALS_REQUEST_UPDATED:   "materials_request.updated",
  MATERIALS_REQUEST_APPROVED:  "materials_request.approved",
  // "sent" is the legacy verb from the retired Store-send model — kept as-is
  // (Enterprise-Wide Real-Time Update Verification Task 2's own instruction:
  // keep older event names for compatibility) since it already fires exactly
  // when a Materials Request becomes fully "Issued" i.e. received; every page
  // that needs to react to a receive watches the "materials_request." prefix,
  // not this exact event name, so nothing actually depends on the literal verb.
  MATERIALS_REQUEST_SENT:      "materials_request.sent",
  STORE_MATERIALS_SENT:        "store_materials.sent",
  MATERIAL_LEDGER_UPDATED:     "material_ledger.updated",
  // Enterprise-Wide Real-Time Update Verification Task 2/7: the direct
  // Offline Inventory Control actions (Add Opening Stock, Import Opening
  // Stock, Add Received Material, Record Used Material) previously emitted
  // nothing at all — only materials received *through* a Materials Request
  // (issueMaterials) triggered a realtime signal, via MATERIAL_LEDGER_UPDATED.
  OFFLINE_INVENTORY_OPENING_STOCK_ADDED: "offline_inventory.opening_stock_added",
  OFFLINE_INVENTORY_IMPORTED:            "offline_inventory.imported",
  OFFLINE_INVENTORY_RECEIVED:            "offline_inventory.received",
  OFFLINE_INVENTORY_USED:                "offline_inventory.used",
  TECHNICIAN_JOB_UPDATED:      "technician_job.updated",
  NOTIFICATION_CREATED:        "notification.created",
  ASSET_UPDATED:               "asset.updated",
  // Work Assignment and Worker Profiles Foundation Unit 7.
  WORKER_PROFILE_UPDATED:      "worker_profile.updated",
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
// Enterprise Real-Time Update Foundation Unit: this table's consumer is now
// /api/notifications/stream (Server-Sent Events, polling this table every
// 15s alongside the existing notifications poll) — not a Socket.IO listener
// as an earlier comment here anticipated. No paid SaaS, no new server
// process, no schema change; the table and this writer already existed with
// no active reader.

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

// ── Convenience wrappers ─────────────────────────────────────────────────────
// Task 7: thin, terse call sites for the two entity types most workflow
// actions emit against — keeps each service function's emit call to one line
// instead of repeating entityType/entityId/actorProfileId at every site.

export function emitJobCardRealtimeEvent(
  eventType: RealtimeEventType,
  workOrderId: string,
  actorId: string
): Promise<void> {
  return emitRealtimeEvent({ eventType, entityType: "work_order", entityId: workOrderId, actorProfileId: actorId });
}

export function emitMaterialsRequestRealtimeEvent(
  eventType: RealtimeEventType,
  partsRequestId: string,
  actorId: string
): Promise<void> {
  return emitRealtimeEvent({ eventType, entityType: "parts_request", entityId: partsRequestId, actorProfileId: actorId });
}

// Enterprise-Wide Real-Time Update Verification Task 2/7: same terse
// one-line-per-call-site convenience the other two entity types already get,
// for the direct Offline Inventory Control actions (Add Opening Stock,
// Import Opening Stock, Add Received Material, Record Used Material).
export function emitOfflineInventoryRealtimeEvent(
  eventType: RealtimeEventType,
  movementId: string | null,
  actorId: string
): Promise<void> {
  return emitRealtimeEvent({ eventType, entityType: "offline_inventory_movement", entityId: movementId, actorProfileId: actorId });
}

// Work Assignment and Worker Profiles Foundation Unit 7.
export function emitWorkerProfileRealtimeEvent(
  workerId: string,
  actorId: string
): Promise<void> {
  return emitRealtimeEvent({ eventType: REALTIME_EVENTS.WORKER_PROFILE_UPDATED, entityType: "worker_profile", entityId: workerId, actorProfileId: actorId });
}
