import { getNotificationEvent } from "@/lib/notifications/events";
import { logNotificationDelivery } from "@/lib/notifications/delivery";
import { isInAppEnabled } from "@/lib/notifications/preferences";
import { resolveRecipientsForEvent } from "@/lib/notifications/recipients";
import { renderNotificationTemplate } from "@/lib/notifications/templates";
import type { NotificationCategory, NotificationListItem, NotificationPriority, NotifyByEventInput, SendNotificationInput } from "@/lib/notifications/types";
import { prisma } from "@/lib/db/prisma";
import { logSystemError } from "@/lib/errors/logging";
import type { Prisma } from "@prisma/client";

type DbNotificationEvent = {
  category: NotificationCategory;
  priority: NotificationPriority;
  is_critical: boolean;
  is_enabled: boolean;
};

async function getNotificationSettings() {
  try {
    const settings = await prisma.app_settings.findUnique({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      select: { force_critical_notifications: true }
    });
    return { forceCritical: settings?.force_critical_notifications ?? true };
  } catch {
    return { forceCritical: true };
  }
}

async function getDbNotificationEvent(eventKey: string): Promise<DbNotificationEvent | null> {
  try {
    const data = await prisma.notification_events.findUnique({
      where: { event_key: eventKey },
      select: { category: true, priority: true, is_critical: true, is_enabled: true }
    });
    if (!data) return null;
    return {
      category: data.category as NotificationCategory,
      priority: data.priority as NotificationPriority,
      is_critical: Boolean(data.is_critical),
      is_enabled: Boolean(data.is_enabled)
    };
  } catch {
    return null;
  }
}

export async function sendNotification(input: SendNotificationInput) {
  try {
    const payload: Prisma.notificationsUncheckedCreateInput = {
      recipient_id: input.recipientUserId,
      recipient_user_id: input.recipientUserId,
      recipient_role: input.recipientRole ?? null,
      recipient_department_id: input.recipientDepartmentId ?? null,
      event_key: input.eventKey,
      category: input.category ?? "System",
      priority: input.priority ?? "normal",
      title: input.title,
      message: input.message,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      action_url: input.actionUrl ?? null,
      action_label: input.actionLabel ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      notification_type: input.eventKey,
      is_read: false,
      read_at: null,
      archived_at: null,
      created_by: input.createdBy ?? null
    };
    const data = await prisma.notifications.create({ data: payload, select: { id: true } });
    await logNotificationDelivery({ notificationId: data.id, eventKey: input.eventKey, recipientUserId: input.recipientUserId, status: "sent" });
    return { ok: true, id: data.id };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown notification error";
    await logNotificationDelivery({ eventKey: input.eventKey, recipientUserId: input.recipientUserId, status: "failed", errorMessage: errMsg });
    await logSystemError({
      severity: input.isCritical ? "error" : "warning",
      source: "notification.send",
      message: `Notification INSERT failed for event "${input.eventKey}": ${errMsg}`,
      stack: error instanceof Error ? error.stack ?? null : null,
      userId: input.createdBy ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: {
        eventKey: input.eventKey,
        recipientUserId: input.recipientUserId,
        priority: input.priority ?? "normal",
        isCritical: input.isCritical ?? false
      }
    });
    return { ok: false, error: "Notification failed" };
  }
}

export async function sendBulkNotifications(inputs: SendNotificationInput[]) {
  const results = [];
  for (const input of inputs) {
    results.push(await sendNotification(input));
  }
  return results;
}

export async function notifyByEvent(input: NotifyByEventInput) {
  try {
    const codeEvent = getNotificationEvent(input.eventKey);
    const dbEvent = await getDbNotificationEvent(input.eventKey);
    const settings = await getNotificationSettings();
    const isCritical = dbEvent?.is_critical ?? codeEvent?.critical ?? false;
    const isGloballyEnabled = dbEvent?.is_enabled ?? true;
    if (!isGloballyEnabled && !(settings.forceCritical && isCritical)) {
      await logNotificationDelivery({ eventKey: input.eventKey, status: "disabled" });
      return [];
    }
    const metadata = { ...(input.metadata ?? {}), entity_id: input.entityId ?? "", action_url: input.actionUrl ?? "" };
    const rendered = await renderNotificationTemplate(input.eventKey, metadata);
    const recipients = await resolveRecipientsForEvent(input.eventKey, {
      recipientUserIds: input.recipientUserIds,
      recipientRoles: input.recipientRoles
    });

    const uniqueRecipients = recipients.filter((recipient) => Boolean(recipient.userId));
    const notifications: SendNotificationInput[] = [];
    for (const recipient of uniqueRecipients) {
      const enabled = await isInAppEnabled(recipient.userId, input.eventKey, settings.forceCritical, isCritical);
      if (!enabled) {
        await logNotificationDelivery({ eventKey: input.eventKey, recipientUserId: recipient.userId, status: "disabled" });
        continue;
      }
      notifications.push({
        recipientUserId: recipient.userId,
        recipientRole: recipient.roleSlug ?? null,
        recipientDepartmentId: recipient.departmentId ?? null,
        eventKey: input.eventKey,
        category: input.category ?? dbEvent?.category ?? codeEvent?.category ?? "System",
        priority: input.priority ?? dbEvent?.priority ?? codeEvent?.priority ?? "normal",
        title: input.title ?? rendered.title,
        message: input.message ?? rendered.message,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? rendered.actionUrl ?? null,
        actionLabel: input.actionLabel ?? rendered.actionLabel ?? null,
        metadata,
        createdBy: input.actorId ?? null,
        isCritical
      });
    }
    return await sendBulkNotifications(notifications);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown notification event error";
    await logNotificationDelivery({ eventKey: input.eventKey, status: "failed", errorMessage: errMsg });
    await logSystemError({
      severity: "error",
      source: "notification.event",
      message: `notifyByEvent failed for "${input.eventKey}": ${errMsg}`,
      stack: error instanceof Error ? error.stack ?? null : null,
      userId: input.actorId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: { eventKey: input.eventKey, entityType: input.entityType, entityId: input.entityId ?? null }
    });
    return [];
  }
}

export async function getUserNotifications(userId: string, options: { limit?: number; offset?: number; includeArchived?: boolean; unreadOnly?: boolean; category?: string; priority?: string; search?: string } = {}) {
  try {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    const where: Prisma.notificationsWhereInput = {
      OR: [{ recipient_user_id: userId }, { recipient_id: userId }],
      ...(options.includeArchived ? {} : { archived_at: null }),
      ...(options.unreadOnly ? { read_at: null, is_read: false } : {}),
      ...(options.category ? { category: options.category } : {}),
      ...(options.priority ? { priority: options.priority } : {})
    };

    if (options.search) {
      const search = options.search.replace(/[%,()]/g, " ").trim().slice(0, 80);
      if (search) {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { message: { contains: search, mode: "insensitive" } }
            ]
          }
        ];
      }
    }

    const data = await prisma.notifications.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        title: true,
        message: true,
        event_key: true,
        category: true,
        priority: true,
        entity_type: true,
        entity_id: true,
        action_url: true,
        action_label: true,
        metadata: true,
        read_at: true,
        archived_at: true,
        created_at: true,
        is_read: true
      }
    });

    return data.map((item) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      event_key: item.event_key,
      category: item.category as NotificationCategory,
      priority: item.priority as NotificationPriority,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      action_url: item.action_url,
      action_label: item.action_label,
      metadata: (item.metadata ?? {}) as Record<string, string | number | boolean | null | undefined>,
      read_at: (item.read_at ?? (item.is_read ? item.created_at : null))?.toISOString() ?? null,
      archived_at: item.archived_at?.toISOString() ?? null,
      created_at: item.created_at.toISOString()
    })) as NotificationListItem[];
  } catch {
    return [];
  }
}

export async function getUnreadNotificationCount(userId: string) {
  try {
    return await prisma.notifications.count({
      where: {
        OR: [{ recipient_user_id: userId }, { recipient_id: userId }],
        archived_at: null,
        read_at: null,
        is_read: false
      }
    });
  } catch {
    return 0;
  }
}

export async function getUserNotificationSummary(userId: string) {
  try {
    const [active, unread, urgent, archived] = await Promise.all([
      prisma.notifications.count({
        where: { OR: [{ recipient_user_id: userId }, { recipient_id: userId }], archived_at: null }
      }),
      prisma.notifications.count({
        where: { OR: [{ recipient_user_id: userId }, { recipient_id: userId }], archived_at: null, read_at: null, is_read: false }
      }),
      prisma.notifications.count({
        where: { OR: [{ recipient_user_id: userId }, { recipient_id: userId }], archived_at: null, priority: { in: ["high", "urgent"] } }
      }),
      prisma.notifications.count({
        where: { OR: [{ recipient_user_id: userId }, { recipient_id: userId }], archived_at: { not: null } }
      })
    ]);

    return { active, unread, urgent, archived };
  } catch {
    return { active: 0, unread: 0, urgent: 0, archived: 0 };
  }
}

export async function markNotificationRead(userId: string, notificationId: string) {
  await prisma.notifications.updateMany({
    where: {
      id: notificationId,
      OR: [{ recipient_user_id: userId }, { recipient_id: userId }]
    },
    data: { is_read: true, read_at: new Date() }
  });
}

export async function markAllNotificationsRead(userId: string) {
  await prisma.notifications.updateMany({
    where: {
      OR: [{ recipient_user_id: userId }, { recipient_id: userId }],
      archived_at: null
    },
    data: { is_read: true, read_at: new Date() }
  });
}

export async function archiveNotification(userId: string, notificationId: string) {
  const now = new Date();
  await prisma.notifications.updateMany({
    where: {
      id: notificationId,
      OR: [{ recipient_user_id: userId }, { recipient_id: userId }]
    },
    data: { archived_at: now, is_read: true, read_at: now }
  });
}
