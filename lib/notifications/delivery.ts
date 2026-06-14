import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export async function logNotificationDelivery(input: {
  notificationId?: string | null;
  eventKey?: string | null;
  recipientUserId?: string | null;
  channel?: "in_app" | "email" | "whatsapp" | "sms" | "push";
  status: "queued" | "sent" | "failed" | "skipped" | "disabled";
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.notification_delivery_logs.create({
      data: {
        notification_id: input.notificationId ?? null,
        event_key: input.eventKey ?? null,
        recipient_user_id: input.recipientUserId ?? null,
        channel: input.channel ?? "in_app",
        status: input.status,
        error_message: input.errorMessage ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        delivered_at: input.status === "sent" ? new Date() : null
      }
    });
  } catch {
    // Delivery logging must never block business workflows.
  }
}
