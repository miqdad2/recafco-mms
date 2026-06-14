export type ArchitectureTone = "green" | "amber" | "red" | "blue" | "gray" | "charcoal";

export type ArchitectureLayer = {
  name: string;
  responsibility: string;
  files: string[];
  securityNote: string;
  status: "completed" | "foundation" | "future";
  tone: ArchitectureTone;
};

export type FlowStep = {
  title: string;
  description: string;
  tone: ArchitectureTone;
};

export type SecurityFeature = {
  feature: string;
  purpose: string;
  status: string;
  tone: ArchitectureTone;
};

export type DatabaseGroup = {
  name: string;
  tone: ArchitectureTone;
  tables: string[];
};

export type RoadmapGroup = {
  area: string;
  tone: ArchitectureTone;
  items: string[];
};

export type SummaryCard = {
  title: string;
  value: string;
  detail: string;
  tone: ArchitectureTone;
};

export const heroBadges = [
  "Next.js App Router",
  "Supabase PostgreSQL",
  "Server-side RBAC",
  "Row Level Security",
  "Private File Storage",
  "PWA Ready",
  "Notification Engine"
];

export const highLevelFlow: FlowStep[] = [
  { title: "User Devices", description: "Desktop browser, mobile browser, and installed PWA shell.", tone: "charcoal" },
  { title: "Next.js UI", description: "Role-based layouts, dashboards, forms, tables, and technician mobile screens.", tone: "blue" },
  { title: "Server Actions / API", description: "Validated mutations, exports, signed URLs, QR services, and workflow commands.", tone: "blue" },
  { title: "Permission Check", description: "Active profile, role, permission, and cost visibility guards.", tone: "red" },
  { title: "Supabase / RLS", description: "Auth, PostgreSQL, private storage, signed URLs, and database-level policies.", tone: "green" },
  { title: "Outputs", description: "Dashboards, Notification Center, reports, Excel exports, print/PDF, and QR codes.", tone: "amber" }
];

export const architectureLayers: ArchitectureLayer[] = [
  {
    name: "Presentation Layer",
    responsibility: "Renders application routes, dashboards, forms, mobile views, System Map, and Architecture page.",
    files: ["app/(dashboard)", "components/layout", "components/ui", "components/architecture"],
    securityNote: "UI hides unauthorized routes, but access is still enforced server-side.",
    status: "completed",
    tone: "blue"
  },
  {
    name: "Business Logic Layer",
    responsibility: "Controls work orders, approvals, assignments, parts/store/purchase/finance, notifications, reports, and exports.",
    files: ["app/actions", "lib/notifications", "lib/reports", "lib/exports", "lib/numbering"],
    securityNote: "Server actions validate input and guard permissions before data writes.",
    status: "completed",
    tone: "charcoal"
  },
  {
    name: "Security Layer",
    responsibility: "Authenticates users, loads active profiles, resolves roles, and enforces permissions and cost visibility.",
    files: ["lib/auth", "lib/permissions", "proxy.ts", "supabase/migrations"],
    securityNote: "Supabase RLS remains the database backstop even if UI code changes.",
    status: "completed",
    tone: "red"
  },
  {
    name: "Data Layer",
    responsibility: "Stores master data, workflow transactions, status history, audit logs, and notification records.",
    files: ["supabase/migrations", "lib/supabase", "types/database.ts"],
    securityNote: "UUID primary keys, indexes, RLS policies, audit trails, and soft-delete patterns protect records.",
    status: "completed",
    tone: "green"
  },
  {
    name: "Storage Layer",
    responsibility: "Stores private work order, asset, and purchase files with metadata and signed viewing URLs.",
    files: ["app/actions/files.ts", "lib/files", "components/files"],
    securityNote: "Files are not public; signed URLs are generated only after permission checks.",
    status: "completed",
    tone: "amber"
  },
  {
    name: "Integration / Future Layer",
    responsibility: "Prepares for external notifications, ERP, HR sync, offline mode, Arabic, and advanced analytics.",
    files: ["docs/technical-architecture.md", "docs/notifications.md"],
    securityNote: "External providers require provider, consent, retention, and data-leak review before activation.",
    status: "future",
    tone: "gray"
  }
];

export const securityFlow: FlowStep[] = [
  { title: "Login", description: "User signs in through Supabase Auth.", tone: "charcoal" },
  { title: "Active Profile", description: "Inactive users cannot load protected context.", tone: "green" },
  { title: "Role Detection", description: "Profile role maps to server-side permission set.", tone: "blue" },
  { title: "Permission Check", description: "Routes and server actions enforce required permissions.", tone: "red" },
  { title: "Supabase RLS", description: "Database policies restrict rows and mutations.", tone: "green" },
  { title: "Audit Log", description: "Important access and workflow actions are tracked.", tone: "amber" }
];

export const roleHierarchy = [
  "Super Admin",
  "IT Admin",
  "CEO / Management",
  "Maintenance Manager",
  "Maintenance Supervisor",
  "Maintenance Data Entry",
  "Technician",
  "Store Keeper",
  "Purchase Officer",
  "Finance Manager",
  "Department Requester",
  "Viewer / Auditor"
];

export const securityFeatures: SecurityFeature[] = [
  { feature: "Supabase Auth", purpose: "Central login and session identity.", status: "Completed", tone: "green" },
  { feature: "Server-side RBAC", purpose: "Routes and actions require explicit permissions.", status: "Completed", tone: "green" },
  { feature: "Active profile checks", purpose: "Inactive users cannot access the app.", status: "Completed", tone: "green" },
  { feature: "RLS policies", purpose: "Database-level row protection.", status: "Completed", tone: "green" },
  { feature: "Private buckets", purpose: "No public access to uploaded documents.", status: "Completed", tone: "green" },
  { feature: "Signed URLs", purpose: "Temporary access for authorized file viewers.", status: "Completed", tone: "green" },
  { feature: "Audit logs", purpose: "Trace administrative and workflow actions.", status: "Completed", tone: "amber" },
  { feature: "Cost visibility guard", purpose: "Protect price, labor, purchase, and finance data.", status: "Completed", tone: "red" },
  { feature: "Notification permissions", purpose: "Users see own notifications; admins manage settings.", status: "Completed", tone: "blue" }
];

export const databaseGroups: DatabaseGroup[] = [
  { name: "Core", tone: "charcoal", tables: ["profiles", "roles", "permissions", "role_permissions", "departments", "app_settings", "audit_logs"] },
  { name: "Maintenance", tone: "blue", tables: ["assets", "asset_documents", "work_orders", "work_order_labor", "work_order_materials", "work_order_assignments", "work_order_status_history", "work_order_attachments"] },
  { name: "Store / Parts", tone: "amber", tables: ["parts", "parts_requests", "parts_request_items", "inventory_movements"] },
  { name: "Purchase / Finance", tone: "red", tables: ["purchase_requests", "purchase_request_items", "approvals"] },
  { name: "Notifications", tone: "green", tables: ["notification_events", "notification_templates", "notifications", "notification_preferences", "notification_delivery_logs"] }
];

export const databaseRelationships: FlowStep[] = [
  { title: "Department -> Users", description: "Profiles belong to departments and roles.", tone: "charcoal" },
  { title: "Department -> Assets", description: "Assets are owned and monitored by departments.", tone: "blue" },
  { title: "Asset -> Work Orders", description: "Maintenance history is built from asset-linked jobs.", tone: "blue" },
  { title: "Work Order -> Execution", description: "Labor, materials, assignments, attachments, and status history.", tone: "green" },
  { title: "Work Order -> Parts Request", description: "Technicians and supervisors request parts against jobs.", tone: "amber" },
  { title: "Parts Request -> Purchase", description: "Unavailable parts create purchase and approval workflow.", tone: "red" },
  { title: "All Actions -> Audit + Notifications", description: "Important actions are logged and communicated.", tone: "green" }
];

export const notificationFlow: FlowStep[] = [
  { title: "Workflow Event", description: "Submitted, approved, assigned, unavailable, finance required, or low stock.", tone: "charcoal" },
  { title: "notifyByEvent()", description: "Single service entry point for in-app notification creation.", tone: "blue" },
  { title: "Recipient Resolver", description: "Central role/user resolution for each workflow handoff.", tone: "blue" },
  { title: "Template Renderer", description: "Event templates render title, message, action label, and URL.", tone: "amber" },
  { title: "Preferences Check", description: "Noncritical alerts respect user preferences; critical alerts can be forced.", tone: "red" },
  { title: "Record + Delivery Log", description: "Notification row and delivery attempt are saved safely.", tone: "green" },
  { title: "Bell / Center", description: "Header bell, unread count, and Notification Center expose alerts.", tone: "green" }
];

export const notificationExamples = [
  "Work order submitted -> Maintenance Manager",
  "Technician assigned -> Technician",
  "Part unavailable -> Purchase Officer",
  "Finance approval required -> Finance Manager",
  "CEO threshold -> CEO / Management",
  "Low stock -> Store Keeper"
];

export const storageFlow: FlowStep[] = [
  { title: "User Uploads File", description: "Photos, documents, quotations, invoices, or delivery notes.", tone: "charcoal" },
  { title: "Client + Server Validation", description: "File type, size, entity, and permission checks.", tone: "red" },
  { title: "Private Bucket", description: "Stored in work-order-files, asset-files, or purchase-files.", tone: "amber" },
  { title: "Metadata Saved", description: "Database links the file to the business record.", tone: "blue" },
  { title: "Signed URL", description: "Authorized users receive temporary viewing links only.", tone: "green" }
];

export const workflowArchitecture: FlowStep[] = [
  { title: "Work Order Created", description: "Data Entry captures paper-form details.", tone: "blue" },
  { title: "Approval", description: "Maintenance Manager approves or rejects.", tone: "amber" },
  { title: "Assignment", description: "Supervisor assigns technicians.", tone: "blue" },
  { title: "Technician Execution", description: "Mobile job start, notes, labor, photos, and completion.", tone: "green" },
  { title: "Parts / Store", description: "Parts request, approval, issue, partial issue, or unavailable marking.", tone: "amber" },
  { title: "Purchase / Finance / CEO", description: "Unavailable parts flow through purchase, finance, and threshold approval.", tone: "red" },
  { title: "Close + History", description: "Supervisor verifies, manager closes, asset history and reports update.", tone: "green" }
];

export const reportingFlow: FlowStep[] = [
  { title: "Data Sources", description: "Work orders, assets, parts, purchase, finance, audit, and notifications.", tone: "charcoal" },
  { title: "Report Query Layer", description: "Server-side filters, grouping, and KPI calculations.", tone: "blue" },
  { title: "Permission Check", description: "Cost columns are removed unless the user can view costs.", tone: "red" },
  { title: "Report Pages", description: "Operational reports for management and departments.", tone: "green" },
  { title: "XLSX / Print / QR", description: "Native Excel, browser print/PDF, and QR route outputs.", tone: "amber" }
];

export const deploymentOptions: RoadmapGroup[] = [
  { area: "Current Demo", tone: "green", items: ["Next.js on local or Vercel", "Supabase cloud project", "Supabase Auth", "Supabase PostgreSQL", "Supabase Storage"] },
  { area: "Future Production", tone: "blue", items: ["Vercel + Supabase", "Company server + managed PostgreSQL", "Company server + self-hosted Supabase if approved", "Kuwait/private cloud if required"] },
  { area: "IT Controls", tone: "red", items: ["Server-only service role key", "Controlled production environment variables", "Database backups", "Monitoring and restore policy"] }
];

export const scalabilityRoadmap: RoadmapGroup[] = [
  { area: "Performance", tone: "blue", items: ["pagination", "query indexes", "report optimization", "caching strategy"] },
  { area: "Security", tone: "red", items: ["2FA", "SSO / Microsoft login", "IP/VPN restriction", "backup and restore policy"] },
  { area: "Mobile", tone: "green", items: ["offline mode", "QR camera scanning", "PWA push notifications"] },
  { area: "Localization", tone: "amber", items: ["Arabic support", "RTL layout"] },
  { area: "Integration", tone: "charcoal", items: ["ERP integration", "HR employee sync", "Purchase/accounting integration", "Email/WhatsApp/SMS providers"] },
  { area: "AI / Predictive Maintenance", tone: "gray", items: ["preventive maintenance scheduler", "failure prediction", "asset downtime analytics", "anomaly detection", "parts demand forecasting"] }
];

export const technicalSummaryCards: SummaryCard[] = [
  { title: "Frontend", value: "Next.js App Router", detail: "Server-rendered protected routes with role-aware layouts.", tone: "blue" },
  { title: "Backend", value: "Server Actions + API Routes", detail: "Validated workflow mutations and exports.", tone: "charcoal" },
  { title: "Database", value: "Supabase PostgreSQL", detail: "UUID tables, indexes, migrations, and RLS.", tone: "green" },
  { title: "Auth", value: "Supabase Auth", detail: "Profile-linked authenticated access.", tone: "red" },
  { title: "Security", value: "RBAC + RLS", detail: "Server permission guards and database policy protection.", tone: "red" },
  { title: "Files", value: "Private Buckets + Signed URLs", detail: "Secure upload and temporary viewing model.", tone: "amber" },
  { title: "Notifications", value: "Event-driven In-App Engine", detail: "Templates, preferences, delivery logs, and bell.", tone: "green" },
  { title: "Exports", value: "Native XLSX", detail: "Audited workbook exports with cost filtering.", tone: "blue" },
  { title: "Mobile", value: "PWA Ready", detail: "Installable shell and mobile navigation.", tone: "green" },
  { title: "Audit", value: "Full Action Tracking", detail: "Workflow, admin, file, export, and view events.", tone: "amber" }
];

export const businessModules = ["Assets", "Work Orders", "Approvals", "Technician Jobs", "Parts Requests", "Store Inventory", "Purchase", "Finance", "Reports", "Notifications"];
export const outputModules = ["Dashboards", "Excel Exports", "Browser Print/PDF", "QR Codes", "Notification Center"];
export const storageBuckets = ["work-order-files", "asset-files", "purchase-files"];
export const storageFileTypes = ["before/after photos", "damaged part photos", "meter/kilometer photos", "asset documents", "registration/insurance/warranty", "quotations", "invoices", "delivery notes"];
export const architectureEnvVars = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_URL"];
