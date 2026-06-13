import { prisma } from "@/lib/db/prisma";
import type { NotificationMetadata } from "@/lib/notifications/types";

const fallbackTemplates: Record<string, { title: string; message: string; actionLabel?: string; actionUrl?: string }> = {
  "work_order.submitted": {
    title: "New work order pending approval",
    message: "Work order {work_order_number} is waiting for your approval.",
    actionLabel: "Review work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "work_order.approved": {
    title: "Work order approved",
    message: "Work order {work_order_number} is approved and ready for assignment.",
    actionLabel: "Open work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "work_order.rejected": {
    title: "Work order rejected",
    message: "Work order {work_order_number} was rejected.",
    actionLabel: "Open work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "work_order.assigned": {
    title: "New job assigned",
    message: "Work order {work_order_number} has been assigned to you.",
    actionLabel: "Open job",
    actionUrl: "/technician/jobs/{entity_id}"
  },
  "work_order.completed": {
    title: "Job completed",
    message: "Work order {work_order_number} is completed by technician and waiting for verification.",
    actionLabel: "Open work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "technician.job_started": {
    title: "Technician started job",
    message: "Work order {work_order_number} has been started by the assigned technician.",
    actionLabel: "Open work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "technician.note_added": {
    title: "Technician note added",
    message: "A technician note was added to the work order.",
    actionLabel: "Open work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "technician.labor_added": {
    title: "Technician labor added",
    message: "Technician labor was recorded for the work order.",
    actionLabel: "Open work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "technician.photo_uploaded": {
    title: "Technician photo uploaded",
    message: "A technician photo was uploaded for the work order.",
    actionLabel: "Open work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "parts_request.submitted": {
    title: "Parts request pending approval",
    message: "Parts request {parts_request_number} is waiting for approval.",
    actionLabel: "Review request",
    actionUrl: "/store/parts-requests/{entity_id}"
  },
  "purchase_request.pending_finance": {
    title: "Finance approval required",
    message: "Purchase request {purchase_request_number} requires finance approval.",
    actionLabel: "Review approval",
    actionUrl: "/finance/approvals"
  },
  "purchase_request.pending_ceo": {
    title: "CEO approval required",
    message: "Purchase request {purchase_request_number} requires CEO approval.",
    actionLabel: "Review request",
    actionUrl: "/purchase/requests/{entity_id}"
  },
  "work_order.clarification_requested": {
    title: "Clarification requested for work order {work_order_number}",
    message: "Maintenance Manager requested more information: {question}",
    actionLabel: "View work order",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "work_order.clarification_responded": {
    title: "Clarification response received for {work_order_number}",
    message: "The requester responded: {response}",
    actionLabel: "Review and decide",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  }
};

function render(value: string | null | undefined, metadata: NotificationMetadata) {
  if (!value) return null;
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const raw = metadata[key];
    return raw === undefined || raw === null ? "" : String(raw);
  });
}

export async function renderNotificationTemplate(eventKey: string, metadata: NotificationMetadata) {
  try {
    const record = await prisma.notification_templates.findFirst({
      where: { event_key: eventKey, channel: "in_app", is_active: true },
      select: { title_template: true, message_template: true, action_label_template: true, action_url_template: true }
    });

    const template = record
      ? {
          title: record.title_template,
          message: record.message_template,
          actionLabel: record.action_label_template ?? undefined,
          actionUrl: record.action_url_template ?? undefined
        }
      : fallbackTemplates[eventKey];

    return {
      title: render(template?.title ?? "Notification", metadata) ?? "Notification",
      message: render(template?.message ?? "A workflow notification requires your attention.", metadata) ?? "A workflow notification requires your attention.",
      actionLabel: render(template?.actionLabel, metadata),
      actionUrl: render(template?.actionUrl, metadata)
    };
  } catch {
    const template = fallbackTemplates[eventKey];
    return {
      title: render(template?.title ?? "Notification", metadata) ?? "Notification",
      message: render(template?.message ?? "A workflow notification requires your attention.", metadata) ?? "A workflow notification requires your attention.",
      actionLabel: render(template?.actionLabel, metadata),
      actionUrl: render(template?.actionUrl, metadata)
    };
  }
}
