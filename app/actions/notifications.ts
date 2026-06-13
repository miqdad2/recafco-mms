"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/log";
import { requirePermission, requireUser } from "@/lib/auth/context";
import { archiveNotification, getUnreadNotificationCount, getUserNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications/service";
import { updateNotificationPreferences } from "@/lib/notifications/preferences";
import { prisma } from "@/lib/db/prisma";

const uuid = z.string().uuid();

export async function getClientNotificationsAction(limit = 20) {
  const context = await requireUser();
  const [notifications, unreadCount] = await Promise.all([
    getUserNotifications(context.userId, { limit }),
    getUnreadNotificationCount(context.userId)
  ]);

  return { notifications, unreadCount };
}

export async function markNotificationReadAction(formData: FormData) {
  const context = await requireUser();
  const id = uuid.parse(formData.get("notification_id"));
  await markNotificationRead(context.userId, id);
  await writeAuditLog({
    actorId: context.userId,
    action: "notification.read",
    entityType: "notification",
    entityId: id,
    summary: "Marked notification as read"
  });
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction() {
  const context = await requireUser();
  await markAllNotificationsRead(context.userId);
  await writeAuditLog({
    actorId: context.userId,
    action: "notification.read_all",
    entityType: "notification",
    summary: "Marked all notifications as read"
  });
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

export async function archiveNotificationAction(formData: FormData) {
  const context = await requireUser();
  const id = uuid.parse(formData.get("notification_id"));
  await archiveNotification(context.userId, id);
  await writeAuditLog({
    actorId: context.userId,
    action: "notification.archive",
    entityType: "notification",
    entityId: id,
    summary: "Archived notification"
  });
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

export async function updateNotificationPreferencesAction(formData: FormData) {
  const context = await requireUser();
  const eventKeys = formData.getAll("event_key").map(String);
  const disabled = new Set(formData.getAll("disabled_event_key").map(String));
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
  revalidatePath("/profile/notifications");
  redirect("/profile/notifications?saved=1");
}

export async function updateNotificationEventAction(formData: FormData) {
  const context = await requirePermission("admin.notification_settings.manage");
  const eventKey = String(formData.get("event_key") ?? "");
  const titleTemplate = String(formData.get("title_template") ?? "").trim();
  const messageTemplate = String(formData.get("message_template") ?? "").trim();
  if (!eventKey) redirect("/admin/notification-settings?error=invalid-event");
  const event = await prisma.notification_events.findUnique({
    where: { event_key: eventKey },
    select: { is_critical: true }
  });
  const isEnabled = event?.is_critical ? true : formData.get("is_enabled") === "on";
  await prisma.notification_events.update({
    where: { event_key: eventKey },
    data: { is_enabled: isEnabled, updated_at: new Date() }
  });
  if (titleTemplate && messageTemplate) {
    await prisma.notification_templates.upsert({
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
  await writeAuditLog({
    actorId: context.userId,
    action: "notification_settings.update",
    entityType: "notification_event",
    summary: `Updated notification event ${eventKey}`,
    metadata: { eventKey, isEnabled, templateUpdated: Boolean(titleTemplate && messageTemplate) }
  });
  revalidatePath("/admin/notification-settings");
  redirect("/admin/notification-settings?saved=1");
}
