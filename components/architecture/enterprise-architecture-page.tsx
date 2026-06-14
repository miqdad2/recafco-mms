import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  Crown,
  Database,
  Factory,
  FileArchive,
  GitBranch,
  Landmark,
  LockKeyhole,
  Network,
  ScrollText,
  ServerCog,
  ShieldCheck,
  ShoppingCart,
  Users,
  Warehouse
} from "lucide-react";

type Tone = "blue" | "purple" | "orange" | "yellow" | "teal" | "red" | "green" | "gray";

type CardItem = {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: Tone;
};

type FlowStep = {
  title: string;
  description?: string;
  tone: Tone;
};

const toneClasses: Record<Tone, { border: string; bg: string; text: string; solid: string; soft: string }> = {
  blue: { border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-700", solid: "bg-[#2563EB]", soft: "text-blue-900" },
  purple: { border: "border-purple-200", bg: "bg-purple-50", text: "text-purple-700", solid: "bg-purple-600", soft: "text-purple-900" },
  orange: { border: "border-orange-200", bg: "bg-orange-50", text: "text-orange-700", solid: "bg-orange-500", soft: "text-orange-900" },
  yellow: { border: "border-yellow-200", bg: "bg-yellow-50", text: "text-yellow-700", solid: "bg-yellow-500", soft: "text-yellow-900" },
  teal: { border: "border-teal-200", bg: "bg-teal-50", text: "text-teal-700", solid: "bg-teal-600", soft: "text-teal-900" },
  red: { border: "border-red-200", bg: "bg-red-50", text: "text-red-700", solid: "bg-[#ED1C24]", soft: "text-red-900" },
  green: { border: "border-green-200", bg: "bg-green-50", text: "text-green-700", solid: "bg-[#16A34A]", soft: "text-green-900" },
  gray: { border: "border-gray-200", bg: "bg-gray-50", text: "text-gray-700", solid: "bg-gray-500", soft: "text-gray-900" }
};

const overview = [
  {
    title: "Frontend",
    icon: Network,
    tone: "blue" as const,
    items: ["Next.js App Router", "Role-based dashboards", "Super Admin control", "Maintenance, Store, Purchase, Finance, CEO views", "Real-time UI update foundation"]
  },
  {
    title: "Backend",
    icon: ServerCog,
    tone: "purple" as const,
    items: ["NestJS modular backend", "Workflow engine", "Approval engine", "Inventory service", "Purchase service", "Notification, audit, permission services"]
  },
  {
    title: "Database",
    icon: Database,
    tone: "green" as const,
    items: ["PostgreSQL single source of truth", "Work orders and workflow steps", "Inventory and purchase orders", "Users, roles, audit logs, notifications"]
  },
  {
    title: "Storage and Real-Time",
    icon: Cloud,
    tone: "orange" as const,
    items: ["Future MinIO/private attachment storage", "WebSocket/SSE planned from NestJS", "Dashboard counters", "Approval alerts", "Urgent CEO notifications"]
  }
];

const backendModules: CardItem[] = [
  { title: "Auth Module", description: "Secure login, session handling, and account state.", icon: ShieldCheck, tone: "blue" },
  { title: "Users & Roles Module", description: "Profiles, roles, permissions, and active user control.", icon: Users, tone: "blue" },
  { title: "Departments Module", description: "Department ownership and request routing foundation.", icon: Building2, tone: "gray" },
  { title: "Maintenance Work Orders Module", description: "Work order creation, details, documents, and closure.", icon: ClipboardList, tone: "green" },
  { title: "Workflow Engine Module", description: "Controls status transitions and step instances.", icon: GitBranch, tone: "purple" },
  { title: "Approvals Module", description: "Sequential approve, reject, and clarification decisions.", icon: ClipboardCheck, tone: "purple" },
  { title: "Inventory / Store Module", description: "Digital stock checks, issue records, shortages, and receiving.", icon: Warehouse, tone: "orange" },
  { title: "Purchase Module", description: "Purchase requests, PO readiness, suppliers, and PO lifecycle.", icon: ShoppingCart, tone: "yellow" },
  { title: "Finance Module", description: "Budget and finance approval queue with cost visibility control.", icon: Landmark, tone: "teal" },
  { title: "CEO Approval Module", description: "Final approval queue for purchase-related requests.", icon: Crown, tone: "red" },
  { title: "Notifications Module", description: "In-app alerts, templates, delivery logs, and future channels.", icon: Bell, tone: "blue" },
  { title: "Audit Logs Module", description: "Immutable history for approvals, changes, and exports.", icon: ScrollText, tone: "gray" },
  { title: "Attachments Module", description: "Private files, signed access, and future MinIO support.", icon: FileArchive, tone: "gray" },
  { title: "Reports Module", description: "Management dashboards, exports, and analytics foundation.", icon: Activity, tone: "green" },
  { title: "Construction / Project Requests Module", description: "Separate project request workflow ending in PO control.", icon: Factory, tone: "blue" }
];

const workflowTables = ["workflow_definitions", "workflow_steps", "workflow_instances", "workflow_step_instances", "approvals", "clarification_requests", "audit_logs", "notifications"];

const maintenanceAvailable: FlowStep[] = [
  { title: "Maintenance Data Entry", tone: "blue" },
  { title: "Maintenance Manager Review", tone: "purple" },
  { title: "Inventory Check", tone: "gray" },
  { title: "Store Keeper Issue", tone: "orange" },
  { title: "Maintenance Manager Assignment", tone: "purple" },
  { title: "Auto / Mechanical / Electrical Team", tone: "green" },
  { title: "Work Completion", tone: "green" },
  { title: "Verification", tone: "purple" },
  { title: "Closure", tone: "green" }
];

const maintenanceUnavailable: FlowStep[] = [
  { title: "Maintenance Data Entry", tone: "blue" },
  { title: "Maintenance Manager Review", tone: "purple" },
  { title: "Inventory Check", tone: "gray" },
  { title: "Store Keeper Shortage Confirmation", tone: "orange" },
  { title: "Production Manager Approval", tone: "purple" },
  { title: "Factory Manager Approval", tone: "purple" },
  { title: "Purchase Manager Approval", tone: "yellow" },
  { title: "Finance Manager Approval", tone: "teal" },
  { title: "CEO Final Approval", tone: "red" },
  { title: "Purchase Officer Creates PO", tone: "yellow" },
  { title: "PO Issued", tone: "yellow" },
  { title: "Waiting for Parts", tone: "orange" },
  { title: "Parts Received", tone: "green" },
  { title: "Assignment", tone: "purple" },
  { title: "Work Completion", tone: "green" },
  { title: "Verification", tone: "purple" },
  { title: "Closure", tone: "green" }
];

const constructionFlow: FlowStep[] = [
  { title: "Project Data Entry", tone: "blue" },
  { title: "Project Manager Approval", tone: "purple" },
  { title: "Construction Manager Approval", tone: "purple" },
  { title: "Purchase Manager Approval", tone: "yellow" },
  { title: "Finance Manager Approval", tone: "teal" },
  { title: "CEO Final Approval", tone: "red" },
  { title: "Purchase Officer Creates PO", tone: "yellow" },
  { title: "PO Issued", tone: "yellow" },
  { title: "Waiting / Ready / Received", tone: "orange" },
  { title: "Project Execution", tone: "green" },
  { title: "Closure", tone: "green" }
];

const securityRules = [
  "Data Entry can create, save draft, and submit only.",
  "Data Entry cannot manually change status.",
  "Maintenance Manager is the first approval authority for maintenance work orders.",
  "Store Keeper confirms stock and issues parts.",
  "Production Manager and Factory Manager are involved only when parts/materials are not available.",
  "Purchase Manager reviews purchase-related requests.",
  "Finance Manager approves finance/budget step.",
  "CEO gives final approval for purchase-related requests.",
  "Purchase Officer creates PO after CEO approval.",
  "Every approval, rejection, and clarification must be audited."
];

const realtimeEvents = [
  "New work order submitted",
  "Approval required",
  "Approval completed",
  "Rejection",
  "Clarification requested",
  "Inventory shortage confirmed",
  "Store issue required",
  "CEO urgent approval required",
  "PO creation required",
  "PO issued",
  "Parts received",
  "Work assigned",
  "Work completed",
  "Verification required",
  "Work order closed"
];

const roadmap = [
  ["Phase 1", "Frontend workflow map and management presentation pages"],
  ["Phase 2", "NestJS backend workflow foundation"],
  ["Phase 3", "Maintenance approval flow activation"],
  ["Phase 4", "Inventory and store integration"],
  ["Phase 5", "Purchase and PO integration"],
  ["Phase 6", "Construction/project request module"],
  ["Phase 7", "Advanced finance, quotations, delegation, analytics"]
];

export function EnterpriseArchitecturePage() {
  return (
    <div className="space-y-7 p-4 lg:p-6">
      <section className="overflow-hidden rounded-md border border-[#1F2937] bg-[#111827] shadow-sm">
        <div className="grid gap-6 p-5 text-white lg:grid-cols-[1.4fr_0.8fr] lg:p-7">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-red-200">Super Admin Architecture</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black leading-tight sm:text-4xl">
              RECAFCO enterprise workflow architecture for maintenance, inventory, purchase, finance, and CEO control.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-200">
              The system direction is a clean monorepo with a Next.js frontend, strong NestJS backend, modular business logic, a single PostgreSQL database, real-time dashboard updates, audit logs, notifications, and workflow-driven approval routing.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {["Clean monorepo", "Workflow-driven enterprise system", "Inventory-aware approval routing", "Purchase and PO workflow"].map((item) => (
              <div key={item} className="rounded-md border border-white/10 bg-white/10 p-4">
                <CheckCircle2 className="h-5 w-5 text-red-200" aria-hidden="true" />
                <p className="mt-2 text-sm font-black">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Section eyebrow="Executive Architecture Overview" title="One controlled enterprise system, not disconnected forms.">
        <div className="grid gap-4 lg:grid-cols-4">
          {overview.map((group) => {
            const Icon = group.icon;
            const tone = toneClasses[group.tone];
            return (
              <div key={group.title} className={`rounded-md border ${tone.border} bg-white p-5 shadow-sm`}>
                <div className="flex items-center gap-3">
                  <span className={`rounded-md p-2 ${tone.bg} ${tone.text}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-base font-black text-[#111827]">{group.title}</h3>
                </div>
                <ul className="mt-4 space-y-2">
                  {group.items.map((item) => (
                    <li key={item} className="flex gap-2 text-sm leading-5 text-[#4B5563]">
                      <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${tone.solid}`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>

      <Section eyebrow="Modular Backend Architecture" title="NestJS modules that own business behavior.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {backendModules.map((module) => (
            <IconCard key={module.title} item={module} />
          ))}
        </div>
      </Section>

      <Section eyebrow="Workflow Engine" title="Work orders are controlled workflows, not simple CRUD records.">
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-md border border-[#ED1C24] bg-red-50 p-5 shadow-sm">
            <GitBranch className="h-8 w-8 text-[#ED1C24]" aria-hidden="true" />
            <h3 className="mt-3 text-xl font-black text-[#111827]">Backend-controlled status transitions</h3>
            <p className="mt-3 text-sm font-semibold leading-6 text-red-900">
              Status transitions are controlled by the backend workflow engine. Users do not manually change critical statuses.
            </p>
            <p className="mt-3 text-sm leading-6 text-[#4B5563]">
              Every critical step is advanced by an allowed action such as approve, reject, request clarification, confirm shortage, issue parts, create PO, receive parts, assign team, verify, or close.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {workflowTables.map((table) => (
              <div key={table} className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
                <p className="font-mono text-xs font-black text-[#ED1C24]">{table}</p>
                <p className="mt-2 text-xs leading-5 text-[#4B5563]">Workflow engine concept used for routing, accountability, notifications, and audit history.</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section eyebrow="Maintenance Workflow Architecture" title="Inventory result decides the operating path.">
        <div className="grid gap-5 xl:grid-cols-2">
          <WorkflowBranch title="Branch A: Parts Available" subtitle="Fast operational path through store issue, assignment, execution, verification, and closure." tone="green" steps={maintenanceAvailable} />
          <WorkflowBranch title="Branch B: Parts Not Available" subtitle="Purchase approval path through Production, Factory, Purchase, Finance, CEO, PO, receiving, assignment, and closure." tone="orange" steps={maintenanceUnavailable} />
        </div>
      </Section>

      <Section eyebrow="Construction / Project Workflow Architecture" title="Separate project flow with CEO approval and PO creation.">
        <WorkflowBranch title="Construction / Project Requests" subtitle="Factory Manager is not involved in construction/project request flow." tone="blue" steps={constructionFlow} compact />
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section eyebrow="Security and Control" title="Authority is explicit.">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <ul className="grid gap-3 sm:grid-cols-2">
              {securityRules.map((rule) => (
                <li key={rule} className="flex gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm leading-5 text-[#4B5563]">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section eyebrow="Real-Time and Notifications" title="Events that should drive queues and alerts.">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              {realtimeEvents.map((event) => (
                <span key={event} className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
                  {event}
                </span>
              ))}
            </div>
          </div>
        </Section>
      </div>

      <Section eyebrow="Roadmap" title="Frontend presentation now, backend workflow activation next.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {roadmap.map(([phase, description], index) => (
            <div key={phase} className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#111827] text-xs font-black text-white">{index + 1}</span>
              <p className="mt-4 text-sm font-black text-[#ED1C24]">{phase}</p>
              <p className="mt-2 text-sm leading-5 text-[#4B5563]">{description}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-black text-[#111827]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function IconCard({ item }: { item: CardItem }) {
  const Icon = item.icon;
  const tone = toneClasses[item.tone];
  return (
    <div className={`rounded-md border ${tone.border} bg-white p-4 shadow-sm`}>
      <span className={`inline-flex rounded-md p-2 ${tone.bg} ${tone.text}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-sm font-black text-[#111827]">{item.title}</h3>
      <p className="mt-2 text-xs leading-5 text-[#4B5563]">{item.description}</p>
    </div>
  );
}

function WorkflowBranch({ title, subtitle, tone, steps, compact = false }: { title: string; subtitle: string; tone: Tone; steps: FlowStep[]; compact?: boolean }) {
  const branchTone = toneClasses[tone];
  return (
    <div className={`rounded-md border ${branchTone.border} ${branchTone.bg} p-5 shadow-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-[#111827]">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-[#4B5563]">{subtitle}</p>
        </div>
        <span className={`rounded-md px-3 py-1 text-xs font-black text-white ${branchTone.solid}`}>{steps.length} steps</span>
      </div>
      <div className={`mt-5 grid gap-3 ${compact ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-2 xl:grid-cols-3"}`}>
        {steps.map((step, index) => {
          const stepTone = toneClasses[step.tone];
          return (
            <div key={`${title}-${step.title}-${index}`} className="relative rounded-md border border-white bg-white p-3 shadow-sm">
              <span className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-black text-white ${stepTone.solid}`}>{index + 1}</span>
              <p className="mt-3 text-sm font-black text-[#111827]">{step.title}</p>
              {step.description ? <p className="mt-1 text-xs text-[#4B5563]">{step.description}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
