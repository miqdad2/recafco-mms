import type { NotificationCategory, NotificationEventKey, NotificationPriority } from "@/lib/notifications/types";

type NotificationEventDefinition = {
  eventKey: NotificationEventKey;
  category: NotificationCategory;
  priority: NotificationPriority;
  critical: boolean;
};

export const notificationEvents: NotificationEventDefinition[] = [
  { eventKey: "work_order.created", category: "Work Orders", priority: "normal", critical: false },
  { eventKey: "work_order.submitted", category: "Approvals", priority: "high", critical: true },
  { eventKey: "work_order.approved", category: "Approvals", priority: "normal", critical: true },
  { eventKey: "work_order.rejected", category: "Approvals", priority: "high", critical: true },
  { eventKey: "work_order.clarification_requested", category: "Approvals", priority: "high", critical: true },
  { eventKey: "work_order.clarification_responded", category: "Approvals", priority: "high", critical: true },
  { eventKey: "work_order.assigned", category: "Technician Jobs", priority: "high", critical: true },
  { eventKey: "work_order.started", category: "Technician Jobs", priority: "normal", critical: false },
  { eventKey: "work_order.completed", category: "Technician Jobs", priority: "high", critical: true },
  { eventKey: "work_order.verified", category: "Approvals", priority: "normal", critical: true },
  { eventKey: "work_order.closed", category: "Work Orders", priority: "normal", critical: true },
  { eventKey: "work_order.reopened", category: "Work Orders", priority: "high", critical: true },
  { eventKey: "work_order.cancelled", category: "Work Orders", priority: "high", critical: true },
  { eventKey: "work_order.overdue", category: "Work Orders", priority: "urgent", critical: true },
  { eventKey: "technician.assigned", category: "Technician Jobs", priority: "high", critical: true },
  { eventKey: "technician.job_started", category: "Technician Jobs", priority: "normal", critical: false },
  { eventKey: "technician.job_completed", category: "Technician Jobs", priority: "high", critical: true },
  { eventKey: "technician.note_added", category: "Technician Jobs", priority: "low", critical: false },
  { eventKey: "technician.labor_added", category: "Technician Jobs", priority: "low", critical: false },
  { eventKey: "technician.photo_uploaded", category: "Technician Jobs", priority: "low", critical: false },
  { eventKey: "parts_request.submitted", category: "Parts Requests", priority: "high", critical: true },
  { eventKey: "parts_request.approved", category: "Parts Requests", priority: "high", critical: true },
  { eventKey: "parts_request.rejected", category: "Parts Requests", priority: "high", critical: true },
  { eventKey: "parts_request.partially_issued", category: "Store / Inventory", priority: "normal", critical: true },
  { eventKey: "parts_request.issued", category: "Store / Inventory", priority: "normal", critical: true },
  { eventKey: "parts_request.unavailable", category: "Store / Inventory", priority: "high", critical: true },
  { eventKey: "purchase_request.created", category: "Purchase", priority: "normal", critical: false },
  { eventKey: "purchase_request.pending_finance", category: "Finance", priority: "high", critical: true },
  { eventKey: "purchase_request.pending_ceo", category: "CEO / Management", priority: "urgent", critical: true },
  { eventKey: "purchase_request.ordered", category: "Purchase", priority: "normal", critical: false },
  { eventKey: "purchase_request.received", category: "Purchase", priority: "normal", critical: true },
  { eventKey: "finance.approved", category: "Finance", priority: "normal", critical: true },
  { eventKey: "finance.rejected", category: "Finance", priority: "high", critical: true },
  { eventKey: "ceo.approved", category: "CEO / Management", priority: "normal", critical: true },
  { eventKey: "ceo.rejected", category: "CEO / Management", priority: "high", critical: true },
  { eventKey: "inventory.low_stock", category: "Store / Inventory", priority: "high", critical: true },
  { eventKey: "file.uploaded", category: "System", priority: "low", critical: false },
  { eventKey: "report.exported", category: "Reports", priority: "low", critical: false },
  { eventKey: "settings.changed", category: "System", priority: "high", critical: true },
  { eventKey: "system_map.updated", category: "System", priority: "normal", critical: false },
  { eventKey: "user.created", category: "System", priority: "normal", critical: false },
  { eventKey: "user.role_changed", category: "System", priority: "high", critical: true },
  { eventKey: "security.account_unlocked", category: "System", priority: "high", critical: true },
  { eventKey: "security.sessions_revoked", category: "System", priority: "high", critical: true }
];

export function getNotificationEvent(eventKey: string) {
  return notificationEvents.find((event) => event.eventKey === eventKey);
}
