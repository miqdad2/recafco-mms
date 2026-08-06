import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getUserNotifications } from "@/lib/notifications/service";
import type { CurrentUserContext } from "@/lib/auth/context";
import type { RoleSlug } from "@/types/database";
import type { WorkflowSuccessIconVariant } from "@/components/ui/workflow-success-modal";

// Role-to-Role Critical Workflow Popup Unit 9G.
//
// A small additive layer on top of the existing notification system — no
// schema change, no new notification event keys, no edit to any
// notifyWorkflowEvent call site. Every event key referenced below
// (job_card.closed, job_card.closure_requested, job_card.assignment_updated,
// job_card.created, job_card.started) already exists and already carries
// the fields this reads: `metadata.job_card_number`, `entity_type`/
// `entity_id`, `action_url`, and `created_by` (surfaced as `actor_id` on
// NotificationListItem) — see lib/backend/work-orders/service.ts,
// work-sessions.ts, and worker-roster.ts.
//
// Task 5 — self-action / actor detection method (documented per the task's
// explicit instruction): `notifications.created_by` (-> `actor_id`) is the
// authoritative field for "who caused this event." A candidate is excluded
// if `actor_id` is null/missing (cannot reliably detect who acted — skip
// rather than guess, per Task 5's own fallback rule) OR if
// `actor_id === context.userId` (the current viewer caused it themselves).
// On top of that self-action guard, each rule also requires the actor's
// CURRENT role (resolved via a live profiles->roles lookup, not stored on
// the notification) to be one of `expectedActorRoles` — this is what makes
// the popup role-to-role (e.g. a Data Entry viewer only pops up
// job_card.assignment_updated when a Manager made the change, not when a
// fellow Data Entry user did), rather than just "anyone but me."

export type CriticalPopupPayload = {
  id: string;
  title: string;
  message: string;
  iconVariant: WorkflowSuccessIconVariant;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string | null;
  secondaryHref: string | null;
  jobCardNumber: string | null;
};

type PopupRule = {
  expectedActorRoles: RoleSlug[];
  title: string;
  iconVariant: WorkflowSuccessIconVariant;
  buildMessage: (jobCardNumber: string) => string;
  primaryLabel: string;
  secondaryLabel?: string;
  secondaryHref?: string;
};

// Task 3 — Data Entry sees a popup only for Manager-originated Job Card
// events.
const DATA_ENTRY_RULES: Record<string, PopupRule> = {
  "job_card.closed": {
    expectedActorRoles: ["maintenance_manager", "super_admin"],
    title: "Job Card Closed",
    iconVariant: "success",
    buildMessage: (n) => `Manager has approved and closed Job Card ${n}.`,
    primaryLabel: "Open Job Card",
    secondaryLabel: "Open Daily Activity",
    secondaryHref: "/maintenance/daily-activity",
  },
  "job_card.assignment_updated": {
    expectedActorRoles: ["maintenance_manager", "super_admin"],
    title: "Job Card Updated",
    iconVariant: "info",
    buildMessage: (n) => `Manager updated Job Card ${n}.`,
    primaryLabel: "Open Job Card",
  },
};

// Task 4 — Manager sees a popup only for Data-Entry-originated Job Card
// events.
const MANAGER_RULES: Record<string, PopupRule> = {
  "job_card.closure_requested": {
    expectedActorRoles: ["maintenance_data_entry", "super_admin"],
    title: "Closure Approval Needed",
    iconVariant: "warning",
    buildMessage: (n) => `Data Entry requested closure for Job Card ${n}.`,
    primaryLabel: "Review Job Card",
  },
  "job_card.created": {
    expectedActorRoles: ["maintenance_data_entry", "super_admin"],
    title: "New Active Job Card",
    iconVariant: "info",
    buildMessage: (n) => `Job Card ${n} has been started.`,
    primaryLabel: "Open Job Card",
  },
  "job_card.started": {
    expectedActorRoles: ["maintenance_data_entry", "super_admin"],
    title: "New Active Job Card",
    iconVariant: "info",
    buildMessage: (n) => `Job Card ${n} has been started.`,
    primaryLabel: "Open Job Card",
  },
};

function rulesForRole(roleSlug: RoleSlug | null | undefined): Record<string, PopupRule> | null {
  if (roleSlug === "maintenance_data_entry") return DATA_ENTRY_RULES;
  if (roleSlug === "maintenance_manager") return MANAGER_RULES;
  return null;
}

// Task 11 — cheap allowlist check for the Notification Center's small
// "Action Required" badge. Deliberately does NOT resolve actor role (that
// would mean a per-row query on a page that can list up to 50 rows) — the
// badge is a lightweight visual hint on the full history page, not the
// trigger for the popup itself, so it's fine for it to be slightly broader
// (event-key match only) than the popup's own stricter actor-role check.
export function isCriticalEventKeyForRole(eventKey: string | null, roleSlug: RoleSlug | null | undefined): boolean {
  const rules = rulesForRole(roleSlug);
  return Boolean(rules && eventKey && rules[eventKey]);
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Task 9 — two modes:
//  - `notificationId` given (SSE-triggered — "new critical notification
//    received after session starts"): check that one specific notification
//    only, no age limit, since it just fired live.
//  - no `notificationId` (initial-mount fallback — "latest critical unread
//    notification from the last 5 minutes"): scan recent unread
//    notifications, keep only ones created within the last 5 minutes, and
//    return the single newest qualifying one. Never scans or pops
//    days-old unread notifications.
// Task 9 also requires never showing more than one popup at once — this
// function always returns at most one candidate; the client component is
// responsible for not calling it again while one is already displayed.
export async function getCriticalWorkflowPopup(
  context: CurrentUserContext,
  notificationId?: string
): Promise<CriticalPopupPayload | null> {
  const rules = rulesForRole(context.role?.slug);
  if (!rules) return null;

  const pool = await getUserNotifications(context.userId, { limit: 20, unreadOnly: true });

  const candidates = notificationId
    ? pool.filter((n) => n.id === notificationId)
    : pool.filter((n) => Date.now() - new Date(n.created_at).getTime() <= FIVE_MINUTES_MS);

  // Task 5 — self-action guard: actor_id must be present and must not be
  // the current viewer.
  const eligible = candidates.filter(
    (n) => n.event_key && rules[n.event_key] && n.actor_id && n.actor_id !== context.userId
  );
  if (eligible.length === 0) return null;

  const actorIds = [...new Set(eligible.map((n) => n.actor_id as string))];
  const actors = await prisma.profiles.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, roles: { select: { slug: true } } },
  });
  const actorRoleById = new Map(actors.map((a) => [a.id, a.roles?.slug as RoleSlug | undefined]));

  const qualifying = eligible
    .filter((n) => {
      const rule = rules[n.event_key as string];
      const actorRole = actorRoleById.get(n.actor_id as string);
      return Boolean(actorRole && rule.expectedActorRoles.includes(actorRole));
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const top = qualifying[0];
  if (!top) return null;

  const rule = rules[top.event_key as string];
  const jobCardNumber = typeof top.metadata.job_card_number === "string" ? top.metadata.job_card_number : null;
  // Task 7 — action_url first, then the Job Card fallback, then /notifications.
  const primaryHref =
    top.action_url ?? (top.entity_type === "work_order" && top.entity_id ? `/maintenance/work-orders/${top.entity_id}` : "/notifications");

  return {
    id: top.id,
    title: rule.title,
    message: rule.buildMessage(jobCardNumber ?? "this Job Card"),
    iconVariant: rule.iconVariant,
    primaryLabel: rule.primaryLabel,
    primaryHref,
    secondaryLabel: rule.secondaryLabel ?? null,
    secondaryHref: rule.secondaryHref ?? null,
    jobCardNumber,
  };
}
