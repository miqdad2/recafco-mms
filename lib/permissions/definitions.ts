import type { PermissionKey, RoleSlug } from "@/types/database";

export const permissions: Record<PermissionKey, string> = {
  "dashboard.view": "View dashboard",
  "admin.users.manage": "Manage users and profiles",
  "admin.roles.view": "View roles and permissions",
  "admin.departments.manage": "Manage departments",
  "admin.settings.manage": "Manage application settings",
  "admin.audit_logs.view": "View audit logs",
  "system_map.view": "View system workflow map",
  "costs.view": "View sensitive costs",
  "assets.view": "View asset master and maintenance history",
  "assets.manage": "Create and update asset master records",
  "parts.view": "View spare parts inventory",
  "parts.manage": "Create and update spare parts inventory",
  "work_orders.view": "View maintenance work orders",
  "work_orders.manage": "Create and update maintenance work orders",
  "work_orders.print": "Open work order print layouts",
  "work_orders.approve": "Approve, reject, and close maintenance work orders",
  "work_orders.assign": "Assign technicians and verify completed maintenance work",
  "technician.jobs.view": "View assigned technician jobs",
  "technician.jobs.update": "Start, update, and complete assigned technician jobs",
  "notifications.view": "View in-app notifications",
  "parts_requests.view": "View parts requests",
  "parts_requests.create": "Create parts requests from work orders",
  "parts_requests.approve": "Approve or reject parts requests",
  "store.issue": "Issue parts and manage store workflow",
  "inventory.movements.view": "View inventory movements",
  "purchase_requests.view": "View purchase requests",
  "purchase_requests.manage": "Create and manage purchase requests",
  "finance.approve": "Approve or reject finance approvals",
  "ceo.approve": "Approve or reject CEO threshold approvals",
  "finance.reports.view": "View finance reports",
  "reports.view": "View operational reports",
  "reports.export": "Export operational reports",
  "files.upload": "Upload private files",
  "files.view": "View private signed files"
};

export const roleLabels: Record<RoleSlug, string> = {
  super_admin: "Super Admin",
  it_admin: "IT Admin",
  ceo_management: "CEO / Management",
  maintenance_manager: "Maintenance Manager",
  maintenance_supervisor: "Maintenance Supervisor",
  maintenance_data_entry: "Maintenance Data Entry",
  technician: "Technician / Mechanic",
  store_keeper: "Store Keeper",
  purchase_officer: "Purchase Officer",
  finance_manager: "Finance Manager",
  department_requester: "Department Requester",
  viewer_auditor: "Viewer / Auditor"
};

export const adminNavigationPermissions: Record<string, PermissionKey> = {
  "/admin/users": "admin.users.manage",
  "/admin/roles": "admin.roles.view",
  "/admin/departments": "admin.departments.manage",
  "/admin/settings": "admin.settings.manage",
  "/admin/audit-logs": "admin.audit_logs.view",
  "/admin/system-map": "system_map.view"
};
