import { prisma } from "@/lib/db/prisma";

export async function getNotificationPreferences(userId: string) {
  return prisma.notification_preferences.findMany({
    where: { user_id: userId },
    select: {
      event_key: true,
      in_app_enabled: true,
      email_enabled: true,
      whatsapp_enabled: true,
      sms_enabled: true,
      push_enabled: true
    }
  });
}

export async function updateNotificationPreferences(userId: string, preferences: Array<{ eventKey: string; inAppEnabled: boolean }>) {
  if (!preferences.length) return;
  await prisma.$transaction(
    preferences.map((preference) =>
      prisma.notification_preferences.upsert({
        where: { user_id_event_key: { user_id: userId, event_key: preference.eventKey } },
        create: {
          user_id: userId,
          event_key: preference.eventKey,
          in_app_enabled: preference.inAppEnabled,
          email_enabled: false,
          whatsapp_enabled: false,
          sms_enabled: false,
          push_enabled: false
        },
        update: {
          in_app_enabled: preference.inAppEnabled,
          email_enabled: false,
          whatsapp_enabled: false,
          sms_enabled: false,
          push_enabled: false,
          updated_at: new Date()
        }
      })
    )
  );
}

export async function isInAppEnabled(userId: string, eventKey: string, forceCritical: boolean, isCritical: boolean) {
  if (forceCritical && isCritical) return true;
  const preference = await prisma.notification_preferences.findUnique({
    where: { user_id_event_key: { user_id: userId, event_key: eventKey } },
    select: { in_app_enabled: true }
  });
  return preference?.in_app_enabled ?? true;
}
