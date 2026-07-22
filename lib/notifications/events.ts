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
  { eventKey: "work_order.inventory_check_completed", category: "Work Orders", priority: "high", critical: true },
  { eventKey: "technician.assigned", category: "Technician Jobs", priority: "high", critical: true },
  { eventKey: "technician.job_started", category: "Technician Jobs", priority: "normal", critical: false },
  { eventKey: "technician.job_completed", category: "Technician Jobs", priority: "high", critical: true },
  { eventKey: "technician.note_added", category: "Technician Jobs", priority: "low", critical: false },
  { eventKey: "technician.labor_added", category: "Technician Jobs", priority: "low", critical: false },
  { eventKey: "technician.photo_uploaded", category: "Technician Jobs", priority: "low", critical: false },
  { eventKey: "parts_request.submitted", category: "Materials Requests", priority: "high", critical: true },
  { eventKey: "parts_request.approved", category: "Materials Requests", priority: "high", critical: true },
  { eventKey: "parts_request.rejected", category: "Materials Requests", priority: "high", critical: true },
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
  { eventKey: "security.sessions_revoked", category: "System", priority: "high", critical: true },

  // Maintenance Workflow Redesign Unit 6. Categories reuse the existing
  // NotificationCategory union rather than adding new ones — no schema
  // change needed. NOTE: the DB CHECK constraint (notification_events_
  // category_check / notifications_category_check) actually allows "Parts
  // Requests", not "Materials Requests" — the NotificationCategory TS type
  // has pre-existing drift where it lists "Materials Requests" as if it were
  // valid (not introduced by this unit). Using "Parts Requests" here so a
  // real notification row (which goes through this same category value)
  // never hits that CHECK constraint. job_card.waiting_materials is defined
  // but only fires from the unwired markJobCardWaitingMaterials primitive
  // (Unit 4) — the Materials Request-driven "waiting stock" path fires
  // material_request.waiting_stock instead, so the same real-world event is
  // never reported twice.
  { eventKey: "job_card.created", category: "Work Orders", priority: "normal", critical: false },
  { eventKey: "job_card.submitted_for_review", category: "Approvals", priority: "normal", critical: true },
  { eventKey: "job_card.reviewed", category: "Approvals", priority: "normal", critical: true },
  { eventKey: "job_card.correction_requested", category: "Approvals", priority: "high", critical: true },
  { eventKey: "job_card.approved", category: "Approvals", priority: "high", critical: true },
  { eventKey: "job_card.waiting_materials", category: "Work Orders", priority: "high", critical: true },
  { eventKey: "job_card.assigned", category: "Work Orders", priority: "high", critical: true },
  { eventKey: "job_card.in_progress", category: "Work Orders", priority: "low", critical: false },
  { eventKey: "job_card.closed", category: "Work Orders", priority: "normal", critical: false },
  { eventKey: "material_request.created", category: "Parts Requests", priority: "normal", critical: false },
  { eventKey: "material_request.approved", category: "Parts Requests", priority: "high", critical: true },
  { eventKey: "material_request.waiting_stock", category: "Store / Inventory", priority: "high", critical: true },
  { eventKey: "material_request.partially_issued", category: "Store / Inventory", priority: "high", critical: true },
  { eventKey: "material_request.issued", category: "Store / Inventory", priority: "high", critical: true },

  // Enterprise Real-Time Notifications Unit — Task 2 item L. Awareness-only,
  // non-critical: Super Admin / Maintenance Manager get a quiet ping on asset
  // create/edit/import, no CEO/Finance/Purchase involvement.
  { eventKey: "asset.updated", category: "Assets", priority: "low", critical: false }
];

export function getNotificationEvent(eventKey: string) {
  return notificationEvents.find((event) => event.eventKey === eventKey);
}
