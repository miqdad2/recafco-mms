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
    title: "Materials request pending approval",
    message: "Materials request {parts_request_number} is waiting for approval.",
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
  },
  "work_order.inventory_check_completed": {
    title: "Inventory check complete — {work_order_number}",
    message: "All required parts have been confirmed by Store Keeper. Work order {work_order_number} is ready for technician assignment.",
    actionLabel: "Open assignments",
    actionUrl: "/maintenance/assignments"
  },

  // Maintenance Workflow Redesign Unit 6 — simplified Job Card / Materials
  // Request templates. "Job Card" and "Materials Request" throughout, never
  // "Work Order"/"Parts Request"; no CEO/Finance/Purchase wording.
  "job_card.created": {
    title: "New Job Card Created",
    message: "Job Card {job_card_number} was created for {asset_name}. Review is required.",
    actionLabel: "Review Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "job_card.submitted_for_review": {
    title: "Job Card Submitted for Review",
    message: "Job Card {job_card_number} was submitted for {asset_name}. Review is required.",
    actionLabel: "Review Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "job_card.reviewed": {
    title: "Job Card Reviewed",
    message: "Job Card {job_card_number} was reviewed and is ready for manager approval.",
    actionLabel: "Open Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "job_card.correction_requested": {
    title: "Correction Requested",
    message: "Correction was requested for Job Card {job_card_number}: {reason}",
    actionLabel: "Open Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "job_card.approved": {
    title: "Job Card Approved",
    message: "Job Card {job_card_number} was approved. Store can review the required materials.",
    actionLabel: "Open Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "job_card.waiting_materials": {
    title: "Job Card Waiting Materials",
    message: "Job Card {job_card_number} is waiting for materials.",
    actionLabel: "Open Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "job_card.assigned": {
    title: "Job Card Assigned",
    message: "Job Card {job_card_number} was assigned to {assignee_name}.",
    actionLabel: "Open Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "job_card.in_progress": {
    title: "Job Card In Progress",
    message: "Work started for Job Card {job_card_number}.",
    actionLabel: "Open Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "job_card.closed": {
    title: "Job Card Closed",
    message: "Job Card {job_card_number} has been closed.",
    actionLabel: "Open Job Card",
    actionUrl: "/maintenance/work-orders/{entity_id}"
  },
  "material_request.created": {
    title: "Materials Requested",
    message: "Materials were requested for Job Card {job_card_number}.",
    actionLabel: "Open Materials Request",
    actionUrl: "/store/parts-requests/{entity_id}"
  },
  "material_request.approved": {
    title: "Materials Request Approved",
    message: "Materials Request {request_number} for Job Card {job_card_number} was approved for Store issue.",
    actionLabel: "Open Materials Request",
    actionUrl: "/store/parts-requests/{entity_id}"
  },
  "material_request.waiting_stock": {
    title: "Waiting Stock",
    message: "Materials for Job Card {job_card_number} are waiting for stock: {reason}",
    actionLabel: "Open Materials Request",
    actionUrl: "/store/parts-requests/{entity_id}"
  },
  "material_request.partially_issued": {
    // Enterprise Real-Time Notifications Unit Task 3: "Partially Issued" is
    // banned as a primary label — reworded to lead with "Materials Sent" and
    // push the partial/remaining detail into the message body only.
    title: "Materials Sent (Some Remaining)",
    message: "Some materials were sent for Job Card {job_card_number} ({issued_quantity} sent, {remaining_quantity} still needed).",
    actionLabel: "Open Materials Request",
    actionUrl: "/store/parts-requests/{entity_id}"
  },
  "material_request.issued": {
    title: "Materials Issued",
    message: "Materials for Job Card {job_card_number} were issued. The Job Card is ready for assignment.",
    actionLabel: "Open Materials Request",
    actionUrl: "/store/parts-requests/{entity_id}"
  },
  "asset.updated": {
    title: "Asset Updated",
    message: "Asset record updated: {asset_code}",
    actionLabel: "Open Asset",
    actionUrl: "/assets/{entity_id}"
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
