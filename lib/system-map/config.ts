export type SystemTone = "green" | "amber" | "red" | "blue" | "gray";

export type SystemPhase = {
  id: string;
  title: string;
  subtitle: string;
  status: "Completed" | "Upcoming" | "Future";
  progress: number;
  items: string[];
};

export type SystemModule = {
  id: string;
  name: string;
  status: "completed" | "active" | "upcoming";
  description: string;
  routes: string[];
  icon: string;
  progress: number;
};

export type ExecutiveWorkflowStep = {
  id: string;
  name: string;
  icon: string;
  tone: SystemTone;
};

export type WorkflowNode = {
  id: string;
  title: string;
  role: string;
  description: string;
  href: string;
  icon: string;
  tone: SystemTone;
};

export type WorkflowEdge = {
  from: string;
  to: string;
  label?: string;
};

export type RoleSwimlane = {
  role: string;
  department: string;
  tone: SystemTone;
  responsibilities: string;
  steps: string[];
  routes: string[];
};

export type ManagementMonitorCard = {
  id: string;
  title: string;
  benefit: string;
  valueLabel: string;
  icon: string;
  tone: SystemTone;
};

export type RoadmapItem = {
  title: string;
  group: "Upcoming" | "Future";
};

export const systemPhases: SystemPhase[] = [
  { id: "phase-1", title: "Phase 1", subtitle: "Foundation", status: "Completed", progress: 100, items: ["Auth", "RBAC", "Super Admin", "Departments", "Users / Profiles", "Settings", "Audit Logs"] },
  { id: "phase-2", title: "Phase 2", subtitle: "Assets, Parts, Work Orders", status: "Completed", progress: 100, items: ["Asset Master", "Spare Parts Inventory", "Work Order CRUD", "Auto Numbering", "Work Order Print", "Demo Data"] },
  { id: "phase-3", title: "Phase 3", subtitle: "Workflow and Technician Execution", status: "Completed", progress: 100, items: ["Approval / Rejection", "Technician Assignment", "Technician Mobile Jobs", "Status History", "Notifications", "Supervisor Verification"] },
  { id: "phase-4", title: "Phase 4", subtitle: "Store, Purchase, Finance", status: "Completed", progress: 100, items: ["Parts Request", "Store Issue", "Inventory Movements", "Purchase Request", "Finance Approval", "CEO Threshold Approval", "Cost Visibility"] },
  { id: "phase-5", title: "Phase 5", subtitle: "Reports, Excel, PDF, PWA Polish", status: "Completed", progress: 100, items: ["Advanced Reports", "Native Excel Exports", "PDF Improvements", "Private File Uploads", "PWA Polish", "Real QR Codes", "Management Demo Polish"] },
  { id: "phase-6", title: "Phase 6", subtitle: "Future Roadmap", status: "Future", progress: 0, items: ["Arabic Support", "Offline Mode", "QR Scanning from Camera", "Preventive Maintenance Calendar", "ERP Integration", "WhatsApp / Email Notifications", "Advanced Analytics"] }
];

export const executiveWorkflowSteps: ExecutiveWorkflowStep[] = [
  { id: "work-order", name: "Work Order", icon: "ClipboardList", tone: "blue" },
  { id: "approval", name: "Approval", icon: "ClipboardCheck", tone: "amber" },
  { id: "assignment", name: "Assignment", icon: "Users", tone: "blue" },
  { id: "technician", name: "Technician", icon: "Wrench", tone: "green" },
  { id: "parts", name: "Parts", icon: "PackageSearch", tone: "amber" },
  { id: "store", name: "Store", icon: "Warehouse", tone: "green" },
  { id: "purchase", name: "Purchase", icon: "ShoppingCart", tone: "blue" },
  { id: "finance", name: "Finance", icon: "Landmark", tone: "amber" },
  { id: "ceo", name: "CEO", icon: "Crown", tone: "red" },
  { id: "closure", name: "Closure", icon: "CheckCircle2", tone: "green" },
  { id: "reports", name: "Reports", icon: "BarChart3", tone: "blue" }
];

export const systemModules: SystemModule[] = [
  { id: "auth", name: "Authentication and RBAC", status: "completed", description: "Secure login, roles, and permissions.", routes: ["/login", "/admin/roles"], icon: "ShieldCheck", progress: 100 },
  { id: "super-admin", name: "Super Admin Control", status: "completed", description: "Full system administration and monitoring.", routes: ["/admin/users"], icon: "Crown", progress: 100 },
  { id: "departments", name: "Department Management", status: "completed", description: "Company department master data.", routes: ["/admin/departments"], icon: "Building2", progress: 100 },
  { id: "users", name: "User/Profile Management", status: "completed", description: "Employee profiles linked to Auth users.", routes: ["/admin/users"], icon: "Users", progress: 100 },
  { id: "assets", name: "Asset Master", status: "completed", description: "Equipment, vehicle, service, and expiry data.", routes: ["/assets"], icon: "Gauge", progress: 100 },
  { id: "parts", name: "Spare Parts Inventory", status: "completed", description: "Stock, supplier, bin, and low-stock control.", routes: ["/store/parts"], icon: "Package", progress: 100 },
  { id: "work-orders", name: "Work Orders", status: "completed", description: "Digital paper-form workflow and numbering.", routes: ["/maintenance/work-orders"], icon: "ClipboardList", progress: 100 },
  { id: "approvals", name: "Approval Workflow", status: "completed", description: "Manager approval, rejection, and closure.", routes: ["/maintenance/approvals"], icon: "ClipboardCheck", progress: 100 },
  { id: "technician", name: "Technician Mobile Jobs", status: "completed", description: "Assigned jobs, notes, labor, and completion.", routes: ["/technician/jobs"], icon: "Wrench", progress: 100 },
  { id: "parts-requests", name: "Parts Requests", status: "completed", description: "Multi-item requests linked to work orders.", routes: ["/store/parts-requests"], icon: "PackageSearch", progress: 100 },
  { id: "store-issue", name: "Store Issue", status: "completed", description: "Full, partial, and unavailable issue flow.", routes: ["/store/parts-requests"], icon: "Warehouse", progress: 100 },
  { id: "inventory", name: "Inventory Movements", status: "completed", description: "Stock issue and receive movement history.", routes: ["/store/inventory-movements"], icon: "Activity", progress: 100 },
  { id: "purchase", name: "Purchase Requests", status: "completed", description: "Unavailable-part purchasing workflow.", routes: ["/purchase/requests"], icon: "ShoppingCart", progress: 100 },
  { id: "finance", name: "Finance Approval", status: "completed", description: "Cost approval and finance reports.", routes: ["/finance/approvals"], icon: "Landmark", progress: 100 },
  { id: "ceo", name: "CEO Threshold Approval", status: "completed", description: "High-value approval foundation.", routes: ["/purchase/requests"], icon: "Crown", progress: 100 },
  { id: "notifications", name: "Notifications", status: "active", description: "Workflow alerts inside the application.", routes: ["/dashboard"], icon: "Bell", progress: 85 },
  { id: "audit", name: "Audit Logs", status: "active", description: "Tracked admin and workflow actions.", routes: ["/admin/audit-logs"], icon: "ScrollText", progress: 85 },
  { id: "settings", name: "Settings", status: "active", description: "Formats, approvals, currency, and thresholds.", routes: ["/admin/settings"], icon: "Settings", progress: 90 },
  { id: "system-map", name: "System Map", status: "active", description: "Management-ready workflow visualization.", routes: ["/admin/system-map"], icon: "Map", progress: 95 }
  ,
  { id: "reports", name: "Advanced Reports", status: "completed", description: "Work order, asset, cost, and preventive reports.", routes: ["/reports/work-orders", "/reports/assets", "/reports/costs", "/reports/preventive-maintenance"], icon: "BarChart3", progress: 100 },
  { id: "exports", name: "Native Excel Exports", status: "completed", description: "Audited .xlsx exports with formatted sheets and frozen headers.", routes: ["/reports/work-orders"], icon: "Download", progress: 100 },
  { id: "private-files", name: "Private File Uploads", status: "completed", description: "Private buckets, metadata, and signed URL viewing.", routes: ["/maintenance/work-orders", "/assets", "/purchase/requests"], icon: "FileLock2", progress: 100 },
  { id: "pwa", name: "PWA Mobile Polish", status: "completed", description: "Manifest, icon, theme color, and mobile navigation.", routes: ["/dashboard", "/technician/jobs"], icon: "Smartphone", progress: 100 },
  { id: "qr-codes", name: "Real QR Codes", status: "completed", description: "Scannable asset and work order QR codes for detail and print pages.", routes: ["/assets", "/maintenance/work-orders"], icon: "QrCode", progress: 100 },
  { id: "demo-polish", name: "Management Demo Polish", status: "completed", description: "Super Admin demo guide, cleaner empty states, and presentation-ready finishing.", routes: ["/admin/demo-guide", "/admin/system-map"], icon: "MonitorPlay", progress: 100 }
];

export const workflowNodes: WorkflowNode[] = [
  { id: "wo-create", title: "Work Order Created", role: "Maintenance Data Entry", description: "Creates the request with asset and complaint details.", href: "/maintenance/work-orders/new", icon: "ClipboardList", tone: "blue" },
  { id: "wo-approval", title: "Work Order Approval", role: "Maintenance Manager", description: "Reviews and approves or rejects the work order.", href: "/maintenance/approvals", icon: "ClipboardCheck", tone: "amber" },
  { id: "assignment", title: "Technician Assignment", role: "Maintenance Supervisor", description: "Assigns approved jobs to technicians.", href: "/maintenance/assignments", icon: "Users", tone: "blue" },
  { id: "technician", title: "Technician Execution", role: "Technician", description: "Starts work, adds notes, labor, and completion details.", href: "/technician/jobs", icon: "Wrench", tone: "green" },
  { id: "parts-request", title: "Parts Request", role: "Technician / Supervisor", description: "Requests required spare parts from the job.", href: "/store/parts-requests", icon: "PackageSearch", tone: "amber" },
  { id: "parts-approval", title: "Parts Approval", role: "Maintenance Manager", description: "Approves or rejects requested parts.", href: "/store/parts-requests", icon: "ClipboardCheck", tone: "amber" },
  { id: "store", title: "Store Issue", role: "Store Keeper", description: "Issues stock or marks items unavailable.", href: "/store/parts-requests", icon: "Warehouse", tone: "green" },
  { id: "purchase", title: "Purchase Request", role: "Purchase Officer", description: "Starts purchasing when parts are unavailable.", href: "/purchase/requests", icon: "ShoppingCart", tone: "blue" },
  { id: "finance", title: "Finance Approval", role: "Finance Manager", description: "Approves or rejects purchase cost.", href: "/finance/approvals", icon: "Landmark", tone: "amber" },
  { id: "ceo", title: "CEO Approval", role: "CEO / Management", description: "Approves high-value threshold requests.", href: "/dashboard", icon: "Crown", tone: "red" },
  { id: "receive", title: "Purchase Receive", role: "Purchase / Store", description: "Receives items and updates inventory.", href: "/purchase/requests", icon: "PackageCheck", tone: "green" },
  { id: "close", title: "Closure and History", role: "Maintenance Manager", description: "Closes verified work and updates asset history.", href: "/assets", icon: "CheckCircle2", tone: "green" },
  { id: "reports", title: "Reports / Dashboard", role: "Management", description: "Monitors dashboards, reports, and audit logs.", href: "/dashboard", icon: "BarChart3", tone: "blue" }
];

export const workflowEdges: WorkflowEdge[] = [
  { from: "wo-create", to: "wo-approval" },
  { from: "wo-approval", to: "assignment" },
  { from: "assignment", to: "technician" },
  { from: "technician", to: "parts-request", label: "Parts needed" },
  { from: "parts-request", to: "parts-approval" },
  { from: "parts-approval", to: "store" },
  { from: "store", to: "purchase", label: "Unavailable" },
  { from: "purchase", to: "finance" },
  { from: "finance", to: "ceo", label: "Over threshold" },
  { from: "ceo", to: "receive" },
  { from: "receive", to: "technician" },
  { from: "technician", to: "close" },
  { from: "close", to: "reports" }
];

export const roleSwimlanes: RoleSwimlane[] = [
  { role: "Maintenance Data Entry", department: "Maintenance", tone: "blue", responsibilities: "Captures paper-form work order details.", steps: ["Create work order", "Add asset and complaint", "Submit for approval"], routes: ["/maintenance/work-orders/new"] },
  { role: "Maintenance Manager", department: "Maintenance", tone: "amber", responsibilities: "Controls approval, parts approval, and closure.", steps: ["Approve work order", "Approve parts", "Close verified work"], routes: ["/maintenance/approvals", "/store/parts-requests"] },
  { role: "Maintenance Supervisor", department: "Maintenance", tone: "blue", responsibilities: "Assigns work and verifies completion.", steps: ["Assign technicians", "Track progress", "Verify completed jobs"], routes: ["/maintenance/assignments"] },
  { role: "Technician", department: "Maintenance", tone: "green", responsibilities: "Executes assigned jobs on mobile.", steps: ["Start job", "Add notes/labor", "Request parts", "Complete job"], routes: ["/technician/jobs"] },
  { role: "Store Keeper", department: "Store", tone: "green", responsibilities: "Controls stock issue and availability.", steps: ["Issue stock", "Partial issue", "Mark unavailable"], routes: ["/store/parts-requests", "/store/inventory-movements"] },
  { role: "Purchase Officer", department: "Purchase", tone: "blue", responsibilities: "Handles unavailable-part purchasing.", steps: ["Create purchase", "Add supplier", "Order and receive"], routes: ["/purchase/requests"] },
  { role: "Finance Manager", department: "Finance", tone: "amber", responsibilities: "Approves purchase cost and reviews reports.", steps: ["Review cost", "Approve/reject", "Monitor finance reports"], routes: ["/finance/approvals", "/finance/reports"] },
  { role: "CEO / Management", department: "Management", tone: "red", responsibilities: "Reviews high-value and business visibility.", steps: ["Threshold approval", "Monitor KPIs", "Review progress"], routes: ["/dashboard", "/admin/system-map"] },
  { role: "Super Admin", department: "IT / System", tone: "red", responsibilities: "Owns full system setup and monitoring.", steps: ["Manage users", "Configure settings", "Audit workflow"], routes: ["/admin/users", "/admin/settings", "/admin/audit-logs"] }
];

export const managementMonitorCards: ManagementMonitorCard[] = [
  { id: "lifecycle", title: "Work order lifecycle", benefit: "See every job from request to closure.", valueLabel: "Operational control", icon: "ClipboardList", tone: "blue" },
  { id: "accountability", title: "Technician accountability", benefit: "Track assigned jobs, notes, labor, and completion.", valueLabel: "Execution visibility", icon: "Wrench", tone: "green" },
  { id: "consumption", title: "Spare part consumption", benefit: "Connect material usage to work orders and assets.", valueLabel: "Stock discipline", icon: "Package", tone: "green" },
  { id: "store-delay", title: "Store issue delays", benefit: "Identify waiting, partial issue, and unavailable parts.", valueLabel: "Delay reduction", icon: "Warehouse", tone: "amber" },
  { id: "purchase", title: "Purchase dependency", benefit: "Expose jobs blocked by unavailable parts.", valueLabel: "Procurement clarity", icon: "ShoppingCart", tone: "blue" },
  { id: "finance", title: "Finance and CEO approvals", benefit: "Control cost approvals and high-value thresholds.", valueLabel: "Cost governance", icon: "Landmark", tone: "red" },
  { id: "history", title: "Asset maintenance history", benefit: "Build a service record for every asset.", valueLabel: "Asset reliability", icon: "Gauge", tone: "green" },
  { id: "department", title: "Department-wise visibility", benefit: "Monitor maintenance demand across departments.", valueLabel: "Management reporting", icon: "Building2", tone: "blue" }
];

export const roadmapItems: RoadmapItem[] = [
  { title: "Arabic support", group: "Future" },
  { title: "Offline mode", group: "Future" },
  { title: "QR scanning from camera", group: "Future" },
  { title: "Preventive maintenance calendar", group: "Future" },
  { title: "ERP integration", group: "Future" },
  { title: "WhatsApp / email notifications", group: "Future" },
  { title: "Advanced analytics", group: "Future" }
];
