import type { RoleSlug } from "@/types/database";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

// Pre-existing drift, found in Unit 6: the notification_events_category_check
// / notifications_category_check DB constraints actually allow "Parts
// Requests", not "Materials Requests" — this type had "Materials Requests"
// as if it were valid, which would have failed at runtime the first time
// anything tried to use it as a real category. Added "Parts Requests" (the
// DB-valid value) rather than removing "Materials Requests", to stay
// additive/reversible; nothing currently uses "Materials Requests".
export type NotificationCategory =
  | "Work Orders"
  | "Approvals"
  | "Technician Jobs"
  | "Materials Requests"
  | "Parts Requests"
  | "Store / Inventory"
  | "Purchase"
  | "Finance"
  | "CEO / Management"
  | "Assets"
  | "Reports"
  | "System";

export type NotificationChannel = "in_app" | "email" | "whatsapp" | "sms" | "push";

export type NotificationEventKey =
  | "work_order.created"
  | "work_order.submitted"
  | "work_order.approved"
  | "work_order.rejected"
  | "work_order.clarification_requested"
  | "work_order.clarification_responded"
  | "work_order.assigned"
  | "work_order.started"
  | "work_order.completed"
  | "work_order.verified"
  | "work_order.closed"
  | "work_order.reopened"
  | "work_order.cancelled"
  | "work_order.overdue"
  | "work_order.inventory_check_completed"
  | "technician.assigned"
  | "technician.job_started"
  | "technician.job_completed"
  | "technician.note_added"
  | "technician.labor_added"
  | "technician.photo_uploaded"
  | "parts_request.created"
  | "parts_request.submitted"
  | "parts_request.approved"
  | "parts_request.rejected"
  | "parts_request.partially_issued"
  | "parts_request.issued"
  | "parts_request.unavailable"
  | "parts_request.waiting_purchase"
  | "parts_request.closed"
  | "inventory.low_stock"
  | "inventory.stock_issued"
  | "inventory.stock_received"
  | "inventory.adjusted"
  | "inventory.returned"
  | "purchase_request.created"
  | "purchase_request.submitted"
  | "purchase_request.pending_finance"
  | "purchase_request.pending_ceo"
  | "purchase_request.approved"
  | "purchase_request.rejected"
  | "purchase_request.ordered"
  | "purchase_request.received"
  | "purchase_request.cancelled"
  | "finance.approval_required"
  | "finance.approved"
  | "finance.rejected"
  | "ceo.approval_required"
  | "ceo.approved"
  | "ceo.rejected"
  | "high_cost_request.created"
  | "asset.service_due"
  | "asset.service_overdue"
  | "asset.registration_expiring"
  | "asset.insurance_expiring"
  | "asset.warranty_expiring"
  | "asset.breakdown_reported"
  | "asset.status_changed"
  | "report.exported"
  | "file.uploaded"
  | "system_map.viewed"
  | "system_map.updated"
  | "user.created"
  | "user.role_changed"
  | "role.changed"
  | "settings.changed"
  | "security.account_unlocked"
  | "security.sessions_revoked"
  // Maintenance Workflow Redesign Unit 6 — simplified Job Card / Materials
  // Request events. Dot-notation kept consistent with every existing key
  // above (job_card_created etc. in the Unit 6 spec are the same events,
  // just written as prose there).
  | "job_card.created"
  | "job_card.submitted_for_review"
  | "job_card.reviewed"
  | "job_card.correction_requested"
  | "job_card.approved"
  | "job_card.waiting_materials"
  | "job_card.assigned"
  | "job_card.in_progress"
  | "job_card.closed"
  | "material_request.created"
  | "material_request.approved"
  | "material_request.waiting_stock"
  | "material_request.partially_issued"
  | "material_request.issued"
  | "asset.updated";

export type NotificationMetadata = Record<string, string | number | boolean | null | undefined>;

export type NotificationRecipient = {
  userId: string;
  roleSlug?: RoleSlug | string | null;
  departmentId?: string | null;
};

export type SendNotificationInput = {
  recipientUserId: string;
  recipientRole?: string | null;
  recipientDepartmentId?: string | null;
  eventKey: NotificationEventKey | string;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  title: string;
  message: string;
  entityType: string;
  entityId?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  metadata?: NotificationMetadata;
  createdBy?: string | null;
  isCritical?: boolean;
};

export type NotifyByEventInput = {
  eventKey: NotificationEventKey | string;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  recipientUserIds?: string[];
  recipientRoles?: RoleSlug[];
  metadata?: NotificationMetadata;
  title?: string;
  message?: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  priority?: NotificationPriority;
  category?: NotificationCategory;
};

export type NotificationListItem = {
  id: string;
  title: string;
  message: string;
  event_key: string | null;
  category: NotificationCategory;
  priority: NotificationPriority;
  entity_type: string;
  entity_id: string | null;
  action_url: string | null;
  action_label: string | null;
  metadata: NotificationMetadata;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
  actor_id: string | null;
};
