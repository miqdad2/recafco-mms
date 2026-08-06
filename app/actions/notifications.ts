"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/log";
import { requirePermission, requireUser } from "@/lib/auth/context";
import { archiveNotification, getUnreadNotificationCount, getUserNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications/service";
import { updateNotificationPreferences } from "@/lib/notifications/preferences";
import { getCriticalWorkflowPopup, type CriticalPopupPayload } from "@/lib/notifications/critical-popup";
import { prisma } from "@/lib/db/prisma";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";

const uuid = z.string().uuid();

// Backend Reliability Fix Unit 1, Task 5: a shared safe-result type for the
// notification actions invoked directly from client code (notification-bell,
// notification-toast-center, hooks/use-notifications) as plain `<form
// action={...}>` targets or awaited calls — none of those callers currently
// destructure/inspect a return value, so adding one here is purely additive
// and does not change any user-facing behavior.
export type NotificationActionResult = { ok: true } | { ok: false; error: string };

export async function getClientNotificationsAction(limit = 20) {
  const context = await requireUser();
  const [notifications, unreadCount] = await Promise.all([
    getUserNotifications(context.userId, { limit }),
    getUnreadNotificationCount(context.userId)
  ]);

  return { notifications, unreadCount };
}

// Role-to-Role Critical Workflow Popup Unit 9G, Task 8 — thin server-action
// wrapper so the client popup component can call this the same way
// `getClientNotificationsAction` is already called from
// notification-toast-center.tsx. Pass a notification id when reacting to a
// live SSE "notification" event; omit it for the one-time initial-mount
// check (see getCriticalWorkflowPopup's own doc comment for the two modes).
export async function getCriticalWorkflowPopupAction(notificationId?: string): Promise<CriticalPopupPayload | null> {
  const context = await requireUser();
  return getCriticalWorkflowPopup(context, notificationId);
}

export async function markNotificationReadAction(formData: FormData): Promise<NotificationActionResult> {
  const context = await requireUser();
  const parsedId = uuid.safeParse(formData.get("notification_id"));
  if (!parsedId.success) {
    return { ok: false, error: "Invalid notification id." };
  }
  const id = parsedId.data;

  try {
    await markNotificationRead(context.userId, id);
    await writeAuditLog({
      actorId: context.userId,
      action: "notification.read",
      entityType: "notification",
      entityId: id,
      summary: "Marked notification as read"
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to mark notification as read." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  const context = await requireUser();

  try {
    await markAllNotificationsRead(context.userId);
    await writeAuditLog({
      actorId: context.userId,
      action: "notification.read_all",
      entityType: "notification",
      summary: "Marked all notifications as read"
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to mark all notifications as read." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  return { ok: true };
}

export async function archiveNotificationAction(formData: FormData): Promise<NotificationActionResult> {
  const context = await requireUser();
  const parsedId = uuid.safeParse(formData.get("notification_id"));
  if (!parsedId.success) {
    return { ok: false, error: "Invalid notification id." };
  }
  const id = parsedId.data;

  try {
    await archiveNotification(context.userId, id);
    await writeAuditLog({
      actorId: context.userId,
      action: "notification.archive",
      entityType: "notification",
      entityId: id,
      summary: "Archived notification"
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to archive notification." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  return { ok: true };
}

export async function updateNotificationPreferencesAction(formData: FormData) {
  const context = await requireUser();
  const eventKeys = formData.getAll("event_key").map(String);
  const disabled = new Set(formData.getAll("disabled_event_key").map(String));

  try {
    await updateNotificationPreferences(
      context.userId,
      eventKeys.map((eventKey) => ({ eventKey, inAppEnabled: !disabled.has(eventKey) }))
    );
    await writeAuditLog({
      actorId: context.userId,
      action: "notification_preferences.update",
      entityType: "notification_preference",
      summary: "Updated notification preferences",
      metadata: { eventKeys, disabledEventKeys: [...disabled] }
    });
  } catch {
    redirect("/profile/notifications?error=save-failed");
  }

  revalidatePath("/profile/notifications");
  redirect("/profile/notifications?saved=1");
}

export async function updateNotificationEventAction(formData: FormData) {
  const context = await requirePermission("admin.notification_settings.manage");
  const eventKey = String(formData.get("event_key") ?? "");
  const titleTemplate = String(formData.get("title_template") ?? "").trim();
  const messageTemplate = String(formData.get("message_template") ?? "").trim();
  if (!eventKey) redirect("/admin/notification-settings?error=invalid-event");

  try {
    const event = await prisma.notification_events.findUnique({
      where: { event_key: eventKey },
      select: { is_critical: true }
    });
    const isEnabled = event?.is_critical ? true : formData.get("is_enabled") === "on";

    // Backend Reliability Fix Unit 1, Task 5: the event enabled/disabled flag
    // and its template upsert now run inside one transaction — previously two
    // separate, unguarded writes, so a template-upsert failure after the flag
    // update could leave the event's enabled state changed without its
    // template updating alongside it.
    await withBackendTransaction(context.userId, async (tx) => {
      await tx.notification_events.update({
        where: { event_key: eventKey },
        data: { is_enabled: isEnabled, updated_at: new Date() }
      });
      if (titleTemplate && messageTemplate) {
        await tx.notification_templates.upsert({
          where: { event_key_channel: { event_key: eventKey, channel: "in_app" } },
          create: {
            event_key: eventKey,
            channel: "in_app",
            title_template: titleTemplate,
            message_template: messageTemplate,
            is_active: true
          },
          update: {
            title_template: titleTemplate,
            message_template: messageTemplate,
            is_active: true,
            updated_at: new Date()
          }
        });
      }
    });

    await writeAuditLog({
      actorId: context.userId,
      action: "notification_settings.update",
      entityType: "notification_event",
      summary: `Updated notification event ${eventKey}`,
      metadata: { eventKey, isEnabled, templateUpdated: Boolean(titleTemplate && messageTemplate) }
    });
  } catch {
    redirect("/admin/notification-settings?error=save-failed");
  }

  revalidatePath("/admin/notification-settings");
  redirect("/admin/notification-settings?saved=1");
}
