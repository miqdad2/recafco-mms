import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  ClipboardList,
  Factory,
  GitBranch,
  Map,
  PackageCheck,
  ShieldAlert,
  ShoppingCart
} from "lucide-react";

import { Button } from "@/components/ui/button";

type Tone = "blue" | "purple" | "orange" | "yellow" | "teal" | "red" | "green" | "gray" | "pink";

type Step = {
  title: string;
  role?: string;
  tone: Tone;
};

const toneClasses: Record<Tone, { border: string; bg: string; text: string; solid: string }> = {
  blue: { border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-700", solid: "bg-[#2563EB]" },
  purple: { border: "border-purple-200", bg: "bg-purple-50", text: "text-purple-700", solid: "bg-purple-600" },
  orange: { border: "border-orange-200", bg: "bg-orange-50", text: "text-orange-700", solid: "bg-orange-500" },
  yellow: { border: "border-yellow-200", bg: "bg-yellow-50", text: "text-yellow-700", solid: "bg-yellow-500" },
  teal: { border: "border-teal-200", bg: "bg-teal-50", text: "text-teal-700", solid: "bg-teal-600" },
  red: { border: "border-red-200", bg: "bg-red-50", text: "text-red-700", solid: "bg-[#ED1C24]" },
  green: { border: "border-green-200", bg: "bg-green-50", text: "text-green-700", solid: "bg-[#16A34A]" },
  gray: { border: "border-gray-200", bg: "bg-gray-50", text: "text-gray-700", solid: "bg-gray-500" },
  pink: { border: "border-pink-200", bg: "bg-pink-50", text: "text-pink-700", solid: "bg-pink-500" }
};

const summaryCards: Array<{ title: string; body: string; icon: LucideIcon; tone: Tone }> = [
  { title: "Maintenance Work Orders", body: "Inventory-aware maintenance workflow with approval routing.", icon: ClipboardList, tone: "blue" },
  { title: "Purchase Approval Flow", body: "Unavailable parts move through Production, Factory, Purchase, Finance, and CEO approval.", icon: ShoppingCart, tone: "yellow" },
  { title: "Construction / Project Requests", body: "Separate project request workflow ending with CEO approval and PO creation.", icon: Factory, tone: "purple" }
];

const commonStart: Step[] = [
  { title: "Maintenance Data Entry", role: "Create request", tone: "blue" },
  { title: "Submit Work Order", role: "Send for review", tone: "blue" },
  { title: "Maintenance Manager Review", role: "First approval", tone: "purple" },
  { title: "Inventory Check", role: "Digital stock check", tone: "gray" },
  { title: "Store Keeper Confirmation", role: "Physical confirmation", tone: "orange" }
];

const availablePath: Step[] = [
  { title: "Store Keeper Issues Parts", tone: "orange" },
  { title: "Maintenance Manager Assigns Team", tone: "purple" },
  { title: "Auto / Mechanical / Electrical Team", tone: "green" },
  { title: "Work In Progress", tone: "green" },
  { title: "Completed by Team", tone: "green" },
  { title: "Supervisor / Manager Verification", tone: "purple" },
  { title: "Closed", tone: "green" }
];

const purchasePath: Step[] = [
  { title: "Store Keeper Confirms Shortage", tone: "orange" },
  { title: "Production Manager Approval", tone: "purple" },
  { title: "Factory Manager Approval", tone: "purple" },
  { title: "Purchase Manager Approval", tone: "yellow" },
  { title: "Finance Manager Approval", tone: "teal" },
  { title: "CEO Final Approval", tone: "red" },
  { title: "Purchase Officer Creates PO", tone: "yellow" },
  { title: "PO Issued", tone: "yellow" },
  { title: "Waiting for Parts", tone: "orange" },
  { title: "Parts Received", tone: "green" },
  { title: "Ready for Assignment", tone: "purple" },
  { title: "Team Work", tone: "green" },
  { title: "Verification", tone: "purple" },
  { title: "Closed", tone: "green" }
];

const constructionSteps: Step[] = [
  { title: "Project Data Entry", tone: "blue" },
  { title: "Project Manager", tone: "purple" },
  { title: "Construction Manager", tone: "purple" },
  { title: "Purchase Manager", tone: "yellow" },
  { title: "Finance Manager", tone: "teal" },
  { title: "CEO", tone: "red" },
  { title: "Purchase Officer PO", tone: "yellow" },
  { title: "Waiting / Ready / Received", tone: "orange" },
  { title: "Project Execution", tone: "green" },
  { title: "Closed", tone: "green" }
];

const swimlanes = [
  ["Maintenance Data Entry", "Create and submit work order", "blue"],
  ["Maintenance Manager", "Review, approve, mark urgent, assign teams, close", "purple"],
  ["System Inventory Engine", "Check digital spare parts availability", "gray"],
  ["Store Keeper", "Confirm stock, issue parts, confirm shortage, receive parts", "orange"],
  ["Production Manager", "Approve unavailable-parts maintenance request", "purple"],
  ["Factory Manager", "Approve unavailable-parts maintenance request", "purple"],
  ["Purchase Manager", "Approve purchase-related request", "yellow"],
  ["Finance Manager", "Approve finance/budget step", "teal"],
  ["CEO", "Final approval, urgent approval attention", "red"],
  ["Purchase Officer", "Create PO after CEO approval", "yellow"],
  ["Maintenance Teams", "Auto, Mechanical, Electrical teams perform work", "green"],
  ["Supervisor / Closure", "Verify completion and close approved work", "green"]
] satisfies Array<[string, string, Tone]>;

const dashboardQueues = [
  ["Maintenance Data Entry Dashboard", ["Drafts", "Submitted work orders", "Rejected work orders", "Clarification required"], "blue"],
  ["Maintenance Manager Dashboard", ["Pending review", "Urgent work orders", "Inventory results", "Ready for assignment", "Completed waiting verification"], "purple"],
  ["Store Keeper Dashboard", ["Stock confirmation required", "Parts to issue", "Shortage confirmation", "Parts received", "Low stock alerts"], "orange"],
  ["Production Manager Dashboard", ["Pending approvals", "Urgent approvals", "Approval history"], "purple"],
  ["Factory Manager Dashboard", ["Pending approvals", "Urgent approvals", "Approval history"], "purple"],
  ["Purchase Manager Dashboard", ["Pending purchase approvals", "Maintenance purchase requests", "Construction purchase requests"], "yellow"],
  ["Finance Manager Dashboard", ["Pending finance approvals", "Budget/cost approval queue"], "teal"],
  ["CEO Dashboard", ["Pending final approvals", "Urgent alerts", "Purchase-related maintenance approvals", "Construction/project approvals"], "red"],
  ["Purchase Officer Dashboard", ["Approved requests waiting for PO", "PO drafts", "PO issued", "Waiting for parts"], "yellow"]
] satisfies Array<[string, string[], Tone]>;

const legend = [
  ["Blue", "Data Entry / Request Creation", "blue"],
  ["Purple", "Manager Approval", "purple"],
  ["Orange", "Inventory / Store", "orange"],
  ["Yellow", "Purchase / PO", "yellow"],
  ["Teal", "Finance", "teal"],
  ["Red", "CEO / Critical Approval", "red"],
  ["Green", "Work Execution / Completion", "green"],
  ["Gray", "System Automation", "gray"],
  ["Pink", "Rejection / Clarification", "pink"]
] satisfies Array<[string, string, Tone]>;

const emergencySteps: Step[] = [
  { title: "Emergency flag", tone: "red" },
  { title: "Maintenance Manager urgent review", tone: "purple" },
  { title: "CEO urgent notification if purchase needed", tone: "red" },
  { title: "High-priority dashboard alert", tone: "red" },
  { title: "Sound/attention alert support", tone: "orange" },
  { title: "Approval still required when money/purchase is involved", tone: "yellow" }
];

export function EnterpriseSystemMap({ editable }: { editable: boolean }) {
  return (
    <div className="space-y-6 p-4 lg:p-6">
      <section className="rounded-md border border-[#1F2937] bg-[#111827] p-5 text-white shadow-sm lg:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-red-200">Super Admin System Map</p>
            <h1 className="mt-3 text-3xl font-black sm:text-4xl">RECAFCO enterprise workflow map</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-200">
              A management-ready view of how maintenance work, inventory availability, purchase approvals, finance control, CEO approval, PO creation, execution, and closure fit together.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <Link href="/admin/system-map/edit">
                <Button variant="secondary">
                  <Map className="h-4 w-4" aria-hidden="true" />
                  Open map editor
                </Button>
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <Section eyebrow="Executive Workflow Summary" title="The workflow in three management blocks.">
        <div className="grid gap-4 lg:grid-cols-3">
          {summaryCards.map((card) => (
            <SummaryCard key={card.title} {...card} />
          ))}
        </div>
      </Section>

      <Section eyebrow="Main Maintenance Workflow Map" title="Common entry, then a clear branch by parts availability.">
        <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <StepGrid steps={commonStart} columns="xl:grid-cols-5" />
          <div className="my-6 grid gap-4 lg:grid-cols-2">
            <BranchPanel title="Fast Operational Path" subtitle="Parts Available" icon={PackageCheck} tone="green" steps={availablePath} />
            <BranchPanel title="Purchase Approval Path" subtitle="Parts Not Available" icon={GitBranch} tone="yellow" steps={purchasePath} />
          </div>
        </div>
      </Section>

      <Section eyebrow="Construction / Project Workflow Map" title="Separate request flow, separate management route.">
        <div className="rounded-md border border-blue-200 bg-blue-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm font-semibold text-blue-900">Project workflow is separate from maintenance work orders.</p>
            <span className="rounded-md border border-blue-200 bg-white px-3 py-1 text-xs font-black text-blue-800">Factory Manager not involved</span>
          </div>
          <div className="mt-5">
            <StepGrid steps={constructionSteps} columns="xl:grid-cols-5" />
          </div>
        </div>
      </Section>

      <Section eyebrow="Role Swimlanes" title="Who owns each step.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {swimlanes.map(([role, responsibility, tone]) => (
            <RoleSwimlane key={role} role={role} responsibility={responsibility} tone={tone} />
          ))}
        </div>
      </Section>

      <Section eyebrow="Dashboard Queue Map" title="What each dashboard should show.">
        <div className="grid gap-4 lg:grid-cols-3">
          {dashboardQueues.map(([title, items, tone]) => (
            <DashboardQueueCard key={title} title={title} items={items} tone={tone} />
          ))}
        </div>
      </Section>

      <Section eyebrow="Color Legend" title="Workflow color language for management review.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {legend.map(([color, label, tone]) => {
            const t = toneClasses[tone];
            return (
              <div key={label} className={`rounded-md border ${t.border} ${t.bg} p-3`}>
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${t.solid}`} />
                  <span className={`text-xs font-black uppercase ${t.text}`}>{color}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[#111827]">{label}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section eyebrow="Emergency Flow Highlight" title="Emergency increases priority and visibility, not financial bypass.">
        <div className="rounded-md border border-red-200 bg-red-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-1 h-7 w-7 shrink-0 text-[#ED1C24]" aria-hidden="true" />
            <div>
              <h3 className="text-xl font-black text-[#111827]">Emergency / Urgent Work Orders</h3>
              <p className="mt-2 text-sm leading-6 text-red-900">
                Emergency does not remove CEO approval for purchase-related requests. It only increases priority and visibility.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <StepGrid steps={emergencySteps} columns="xl:grid-cols-6" />
          </div>
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

function SummaryCard({ title, body, icon: Icon, tone }: { title: string; body: string; icon: LucideIcon; tone: Tone }) {
  const t = toneClasses[tone];
  return (
    <div className={`rounded-md border ${t.border} bg-white p-5 shadow-sm`}>
      <span className={`inline-flex rounded-md p-3 ${t.bg} ${t.text}`}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-lg font-black text-[#111827]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#4B5563]">{body}</p>
    </div>
  );
}

function StepGrid({ steps, columns = "xl:grid-cols-4" }: { steps: Step[]; columns?: string }) {
  return (
    <div className={`grid gap-3 md:grid-cols-2 ${columns}`}>
      {steps.map((step, index) => (
        <WorkflowStepCard key={`${step.title}-${index}`} step={step} index={index} />
      ))}
    </div>
  );
}

function WorkflowStepCard({ step, index }: { step: Step; index: number }) {
  const t = toneClasses[step.tone];
  return (
    <div className={`relative rounded-md border ${t.border} bg-white p-4 shadow-sm`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-black text-white ${t.solid}`}>{index + 1}</span>
        <div>
          <h3 className="text-sm font-black text-[#111827]">{step.title}</h3>
          {step.role ? <p className="mt-1 text-xs font-semibold text-[#4B5563]">{step.role}</p> : null}
        </div>
      </div>
    </div>
  );
}

function BranchPanel({ title, subtitle, icon: Icon, tone, steps }: { title: string; subtitle: string; icon: LucideIcon; tone: Tone; steps: Step[] }) {
  const t = toneClasses[tone];
  return (
    <div className={`rounded-md border ${t.border} ${t.bg} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-black uppercase ${t.text}`}>{title}</p>
          <h3 className="mt-1 text-lg font-black text-[#111827]">{subtitle}</h3>
        </div>
        <span className={`rounded-md p-2 text-white ${t.solid}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <div className="mt-4">
        <StepGrid steps={steps} />
      </div>
    </div>
  );
}

function RoleSwimlane({ role, responsibility, tone }: { role: string; responsibility: string; tone: Tone }) {
  const t = toneClasses[tone];
  return (
    <div className={`rounded-md border ${t.border} bg-white p-4 shadow-sm`}>
      <div className="flex gap-3">
        <span className={`mt-1 h-10 w-1.5 rounded-full ${t.solid}`} />
        <div>
          <h3 className="text-sm font-black text-[#111827]">{role}</h3>
          <p className="mt-2 text-sm leading-5 text-[#4B5563]">{responsibility}</p>
        </div>
      </div>
    </div>
  );
}

function DashboardQueueCard({ title, items, tone }: { title: string; items: string[]; tone: Tone }) {
  const t = toneClasses[tone];
  return (
    <div className={`rounded-md border ${t.border} bg-white p-4 shadow-sm`}>
      <div className="flex items-center gap-2">
        <BellRing className={`h-4 w-4 ${t.text}`} aria-hidden="true" />
        <h3 className="text-sm font-black text-[#111827]">{title}</h3>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-[#4B5563]">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${t.solid}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
