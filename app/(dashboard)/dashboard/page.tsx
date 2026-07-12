import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Gauge,
  Package,
  PlusCircle,
  ShoppingCart,
  Upload,
  Users,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";
import { displayStatus } from "@/lib/display/work-order-labels";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { AutoRefresh } from "@/components/auto-refresh";
import {
  RepairOrderQuickView,
  type QuickViewData,
} from "@/components/work-orders/repair-order-quick-view";

// ── Types ─────────────────────────────────────────────────────────────
type WoRow = { id: string; work_order_number: string | null; status: string; updated_at: string };
type PrRow = { id: string; parts_request_number: string | null; status: string; created_at: string };
type MgActionRow = {
  id: string;
  work_order_number: string | null;
  status: string;
  updated_at: string;
  created_at: string;
  description_of_work: string | null;
  asset_name: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────
async function safeNum(query: Promise<number>): Promise<number> {
  try { return await query; } catch { return 0; }
}

function woTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (["Closed", "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) return "green";
  if (["Rejected", "Cancelled"].includes(status)) return "red";
  if (["Waiting for Parts", "Waiting for Purchase"].includes(status)) return "amber";
  if (status === "Draft") return "gray";
  return "blue";
}

function prTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (status === "Issued") return "green";
  if (status === "Partially Issued") return "amber";
  if (status === "Waiting for Purchase") return "red";
  if (status === "Waiting for Store") return "blue";
  return "gray";
}

function ageLabel(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days}d ago`;
}

function mgActionMeta(status: string): { label: string; style: string } {
  if (["Submitted", "Pending Approval"].includes(status)) {
    return {
      label: "Assign",
      style: "border-[#ED1C24] bg-[#ED1C24] text-white hover:bg-red-700",
    };
  }
  if (["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) {
    return {
      label: "Close",
      style: "border-[#16A34A] bg-[#16A34A] text-white hover:bg-green-700",
    };
  }
  return {
    label: "View",
    style: "border-[#E5E7EB] text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]",
  };
}

// ── Shared components ─────────────────────────────────────────────────
function QuickAction({ label, href, icon: Icon, iconBg, iconColor }: {
  label: string; href: string; icon: LucideIcon; iconBg: string; iconColor: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-md border border-[#DDE2EA] bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-[#C9D0DA] hover:shadow-md"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
      </span>
      <span className="text-sm font-bold text-[#111827]">{label}</span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[#D1D5DB] transition group-hover:translate-x-0.5 group-hover:text-[#6B7280]" aria-hidden="true" />
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-widest text-[#9CA3AF]">{children}</p>;
}

function WoRow({ row }: { row: WoRow }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#111827]">
        {row.work_order_number ?? <span className="text-xs italic text-[#9CA3AF]">Draft</span>}
      </span>
      <StatusBadge label={displayStatus(row.status)} tone={woTone(row.status)} />
      <span className="hidden shrink-0 text-xs text-[#9CA3AF] sm:block">{formatDateTime(row.updated_at)}</span>
      <Link href={`/maintenance/work-orders/${row.id}`} className="shrink-0 rounded border border-[#E5E7EB] px-2 py-1 text-xs font-bold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]">
        View
      </Link>
    </div>
  );
}

function ManagerActionRow({ row }: { row: MgActionRow }) {
  const action = mgActionMeta(row.status);
  // Close requires full work-order page; Assign/View open quick-view modal via ?preview param
  const actionHref =
    action.label === "Close"
      ? `/maintenance/work-orders/${row.id}`
      : `?preview=${row.id}`;
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link
          href={`?preview=${row.id}`}
          className="block"
        >
          <p className="text-sm font-semibold text-[#111827] hover:text-[#ED1C24]">
            {row.work_order_number ?? <span className="text-xs italic text-[#9CA3AF]">Draft</span>}
            {row.asset_name && (
              <span className="ml-2 text-xs font-normal text-[#6B7280]">· {row.asset_name}</span>
            )}
          </p>
          {row.description_of_work && (
            <p className="truncate text-xs text-[#4B5563]">{row.description_of_work}</p>
          )}
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge label={displayStatus(row.status)} tone={woTone(row.status)} />
        <span className="hidden text-xs text-[#9CA3AF] sm:block">{ageLabel(row.created_at)}</span>
        <Link
          href={actionHref}
          className={`shrink-0 rounded border px-2 py-1 text-xs font-bold transition ${action.style}`}
        >
          {action.label}
        </Link>
      </div>
    </div>
  );
}

function PrRow({ row }: { row: PrRow }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#111827]">
        {row.parts_request_number ?? "—"}
      </span>
      <StatusBadge label={row.status} tone={prTone(row.status)} />
      <span className="hidden shrink-0 text-xs text-[#9CA3AF] sm:block">{formatDateTime(row.created_at)}</span>
      <Link href={`/store/parts-requests/${row.id}`} className="shrink-0 rounded border border-[#E5E7EB] px-2 py-1 text-xs font-bold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]">
        View
      </Link>
    </div>
  );
}

function ActivityList({ title, viewAllHref, empty, children }: {
  title: string; viewAllHref: string; empty: boolean; children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>{title}</SectionLabel>
        <Link href={viewAllHref} className="text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]">View all</Link>
      </div>
      <div className="divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
        {empty
          ? <p className="py-8 text-center text-sm text-[#4B5563]">Nothing here yet.</p>
          : children
        }
      </div>
    </section>
  );
}

// ── KPI row helper ────────────────────────────────────────────────────
type KpiCard = {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: "red" | "amber" | "green" | "blue" | "gray";
  href: string;
};

function KpiRow({ cards, cols }: { cards: KpiCard[]; cols: string }) {
  return (
    <div className={`grid grid-cols-2 gap-2 ${cols}`}>
      {cards.map((c) => (
        <Link key={c.label} href={c.href} className="block">
          <StatCard label={c.label} value={c.value} icon={c.icon} tone={c.tone} compact />
        </Link>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
type PageProps = { searchParams?: Promise<{ preview?: string }> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const context = await requireUser();
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const roleSlug = context.role?.slug ?? "";

  const isNormalUser  = roleSlug === "maintenance_data_entry";
  const isManager     = roleSlug === "maintenance_manager";
  const isTechnician  = roleSlug === "technician";
  const isStoreKeeper = roleSlug === "store_keeper";
  const isSuperAdmin  = roleSlug === "super_admin";

  // ── Normal User data ─────────────────────────────────────────────
  const [nuQueue, nuRecent] = isNormalUser ? await Promise.all([
    Promise.all([
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: ["Submitted", "Pending Approval"] } }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: ["In Progress", "Parts Issued"] } }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: ["Waiting for Parts", "Waiting for Purchase"] } }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Rejected" }] } })),
      safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Draft" }] } })),
    ]),
    prisma.work_orders
      .findMany({
        where: { AND: [{ deleted_at: null }, visibilityFilter] },
        select: { id: true, work_order_number: true, status: true, updated_at: true },
        orderBy: { updated_at: "desc" },
        take: 5,
      })
      .then((rows): WoRow[] => rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })))
      .catch((): WoRow[] => []),
  ]) : [null, [] as WoRow[]];

  // ── Manager data ─────────────────────────────────────────────────
  const mgBase = { AND: [{ deleted_at: null }, visibilityFilter] };

  const mgData = isManager
    ? await Promise.all([
        // KPI counts
        Promise.all([
          safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: { in: ["Submitted", "Pending Approval"] } }] } })),
          safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: "Assigned" }] } })),
          safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: { in: ["In Progress", "Parts Issued"] } }] } })),
          safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: { in: ["Waiting for Parts", "Waiting for Purchase"] } }] } })),
          safeNum(prisma.work_orders.count({ where: { AND: [mgBase, { status: { in: ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"] } }] } })),
        ]),
        // Needs Your Action rows — items awaiting manager decision
        prisma.work_orders
          .findMany({
            where: { AND: [mgBase, { status: { in: ["Submitted", "Pending Approval", "Completed by Technician", "Verified by Supervisor"] } }] },
            select: {
              id: true,
              work_order_number: true,
              status: true,
              updated_at: true,
              created_at: true,
              description_of_work: true,
              assets: { select: { asset_name: true } },
            },
            orderBy: { updated_at: "asc" },
            take: 5,
          })
          .then((rows): MgActionRow[] =>
            rows.map((r) => ({
              id:                   r.id,
              work_order_number:    r.work_order_number,
              status:               r.status,
              updated_at:           r.updated_at.toISOString(),
              created_at:           r.created_at.toISOString(),
              description_of_work:  r.description_of_work ?? null,
              asset_name:           r.assets?.asset_name ?? null,
            }))
          )
          .catch((): MgActionRow[] => []),
        // Materials Waiting — open materials requests
        prisma.parts_requests
          .findMany({
            where: { status: { in: ["Waiting for Store", "Waiting for Purchase", "Partially Issued"] } },
            select: { id: true, parts_request_number: true, status: true, created_at: true },
            orderBy: { created_at: "asc" },
            take: 5,
          })
          .then((rows): PrRow[] =>
            rows.map((r) => ({
              id:                   r.id,
              parts_request_number: r.parts_request_number,
              status:               r.status,
              created_at:           r.created_at.toISOString(),
            }))
          )
          .catch((): PrRow[] => []),
      ])
    : null;

  const mgQueue     = mgData?.[0] ?? null;
  const mgAction    = (mgData?.[1] ?? []) as MgActionRow[];
  const mgMaterials = (mgData?.[2] ?? []) as PrRow[];

  // ── Technician data ──────────────────────────────────────────────
  const [techQueue, techJobs] = isTechnician ? await Promise.all([
    Promise.all([
      safeNum(prisma.work_order_assignments.count({ where: { technician_id: context.userId, work_orders: { deleted_at: null, status: "Assigned" } } })),
      safeNum(prisma.work_order_assignments.count({ where: { technician_id: context.userId, work_orders: { deleted_at: null, status: "In Progress" } } })),
      safeNum(prisma.work_order_assignments.count({ where: { technician_id: context.userId, work_orders: { deleted_at: null, status: { in: ["Waiting for Parts", "Waiting for Purchase"] } } } })),
      safeNum(prisma.work_order_assignments.count({ where: { technician_id: context.userId, work_orders: { deleted_at: null, status: "Completed by Technician" } } })),
    ]),
    prisma.work_order_assignments
      .findMany({
        where: { technician_id: context.userId, work_orders: { deleted_at: null } },
        select: { work_order_id: true, work_orders: { select: { work_order_number: true, status: true, updated_at: true } } },
        orderBy: { assigned_at: "desc" },
        take: 5,
      })
      .then((rows): WoRow[] => rows.map((r) => ({
        id: r.work_order_id,
        work_order_number: r.work_orders.work_order_number,
        status: r.work_orders.status,
        updated_at: r.work_orders.updated_at.toISOString(),
      })))
      .catch((): WoRow[] => []),
  ]) : [null, [] as WoRow[]];

  // ── Store Keeper data ────────────────────────────────────────────
  const [skQueue, skRecent] = isStoreKeeper ? await Promise.all([
    Promise.all([
      safeNum(prisma.parts_requests.count({ where: { status: "Waiting for Store" } })),
      safeNum(prisma.parts_requests.count({ where: { status: "Partially Issued" } })),
      safeNum(prisma.parts.count({ where: { deleted_at: null, status: "Low Stock" } })),
      safeNum(prisma.parts_requests.count({ where: { status: "Waiting for Purchase" } })),
    ]),
    prisma.parts_requests
      .findMany({
        where: { status: { in: ["Waiting for Store", "Partially Issued"] } },
        select: { id: true, parts_request_number: true, status: true, created_at: true },
        orderBy: { created_at: "asc" },
        take: 5,
      })
      .then((rows): PrRow[] => rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })))
      .catch((): PrRow[] => []),
  ]) : [null, [] as PrRow[]];

  // ── Super Admin data ─────────────────────────────────────────────
  const [saCount, saRecent] = isSuperAdmin ? await Promise.all([
    Promise.all([
      safeNum(prisma.assets.count({ where: { deleted_at: null } })),
      safeNum(prisma.work_orders.count({ where: { deleted_at: null, status: { notIn: ["Closed", "Rejected", "Cancelled"] } } })),
      safeNum(prisma.work_orders.count({ where: { deleted_at: null, status: { in: ["Waiting for Parts", "Waiting for Purchase"] } } })),
      safeNum(prisma.parts.count({ where: { deleted_at: null, status: "Low Stock" } })),
      safeNum(prisma.profiles.count({ where: { deleted_at: null, is_active: true } })),
    ]),
    prisma.work_orders
      .findMany({
        where: { deleted_at: null },
        select: { id: true, work_order_number: true, status: true, updated_at: true },
        orderBy: { updated_at: "desc" },
        take: 5,
      })
      .then((rows): WoRow[] => rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })))
      .catch((): WoRow[] => []),
  ]) : [null, [] as WoRow[]];

  // ── Quick-view preview (manager / super-admin only) ─────────────────
  const sp = (await searchParams) ?? {};
  const rawPreview = sp.preview ?? null;
  const previewId =
    rawPreview && /^[0-9a-f-]{36}$/i.test(rawPreview) ? rawPreview : null;

  const canAssignModal =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("work_orders.assign") ||
    context.permissions.includes("work_orders.approve");

  const OPEN_PR_STATUSES = [
    "Pending Approval",
    "Waiting for Store",
    "Partially Issued",
    "Waiting for Purchase",
  ];

  const [previewWO, prPreviewData, techsForModal] = previewId
    ? await Promise.all([
        prisma.work_orders.findFirst({
          where: { AND: [{ id: previewId }, { deleted_at: null }, visibilityFilter] },
          select: {
            id: true,
            work_order_number: true,
            status: true,
            priority: true,
            maintenance_type: true,
            worker_type: true,
            operator_complaint: true,
            description_of_work: true,
            ordered_by: true,
            date_of_order: true,
            created_at: true,
            job_location: true,
            assets: {
              select: {
                id: true,
                asset_code: true,
                asset_name: true,
                location: true,
                condition: true,
                criticality: true,
              },
            },
            departments: { select: { name: true } },
            work_order_assignments: {
              select: {
                assignment_type: true,
                external_name: true,
                external_company: true,
                external_contact_person: true,
                external_phone: true,
                external_trade: true,
                profiles: { select: { full_name: true } },
              },
            },
            _count: { select: { work_order_required_parts: true } },
          },
        }),
        prisma.parts_requests.findMany({
          where: { work_order_id: previewId },
          select: { status: true },
          orderBy: { created_at: "desc" },
          take: 20,
        }),
        canAssignModal
          ? prisma.profiles.findMany({
              where: { is_active: true, deleted_at: null },
              select: { id: true, full_name: true },
              orderBy: { full_name: "asc" },
            })
          : Promise.resolve([] as Array<{ id: string; full_name: string }>),
      ])
    : [null, [] as Array<{ status: string }>, [] as Array<{ id: string; full_name: string }>];

  const isAdmin = context.role?.slug === "super_admin";
  const drawerData: QuickViewData | null = previewWO
    ? {
        id: previewWO.id,
        work_order_number: previewWO.work_order_number,
        status: previewWO.status,
        displayStatus: displayStatus(previewWO.status),
        priority: previewWO.priority,
        maintenance_type: previewWO.maintenance_type,
        worker_type: previewWO.worker_type,
        operator_complaint: previewWO.operator_complaint,
        description_of_work: previewWO.description_of_work,
        ordered_by: previewWO.ordered_by,
        date_of_order: previewWO.date_of_order?.toISOString() ?? null,
        created_at: previewWO.created_at.toISOString(),
        job_location: previewWO.job_location,
        assets: previewWO.assets
          ? {
              id: previewWO.assets.id,
              asset_code: previewWO.assets.asset_code,
              asset_name: previewWO.assets.asset_name,
              location: previewWO.assets.location,
              condition: previewWO.assets.condition,
              criticality: previewWO.assets.criticality,
            }
          : null,
        department_name: previewWO.departments?.name ?? null,
        technician_names: previewWO.work_order_assignments
          .filter(
            (a) =>
              a.assignment_type === "INTERNAL_TECHNICIAN" && a.profiles?.full_name,
          )
          .map((a) => a.profiles!.full_name),
        technicians: techsForModal,
        primary_assignment: previewWO.work_order_assignments[0]
          ? {
              assignment_type:
                previewWO.work_order_assignments[0].assignment_type,
              external_name:
                previewWO.work_order_assignments[0].external_name ?? null,
              external_company:
                previewWO.work_order_assignments[0].external_company ?? null,
              external_contact_person:
                previewWO.work_order_assignments[0].external_contact_person ??
                null,
              external_phone:
                previewWO.work_order_assignments[0].external_phone ?? null,
              external_trade:
                previewWO.work_order_assignments[0].external_trade ?? null,
            }
          : null,
        required_parts_count: previewWO._count.work_order_required_parts,
        parts_requests_count: prPreviewData.length,
        open_parts_requests_count: prPreviewData.filter((pr) =>
          OPEN_PR_STATUSES.includes(pr.status),
        ).length,
        last_parts_request_status: prPreviewData[0]?.status ?? null,
        roleSlug: context.role?.slug ?? "",
        canApprove: isAdmin || context.permissions.includes("work_orders.approve"),
        canAssign: isAdmin || context.permissions.includes("work_orders.assign"),
        canManage: isAdmin || context.permissions.includes("work_orders.manage"),
        canCreateParts:
          isAdmin ||
          context.permissions.includes("parts_requests.create") ||
          context.permissions.includes("work_orders.manage"),
        closeHref: "/dashboard",
      }
    : null;

  const firstName = context.profile.full_name.split(" ")[0];

  return (
    <>
      <AutoRefresh intervalMs={30000} />
      <PageHeader
        title={`Hello, ${firstName}`}
        description="Here's what needs your attention today."
      />
      <div className="space-y-4 p-4 pb-8 sm:p-5">

        {/* ── NORMAL USER ─────────────────────────────────────────── */}
        {isNormalUser && nuQueue && (
          <>
            {/* Draft alert */}
            {nuQueue[4] > 0 && (
              <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <p className="flex-1 text-sm font-semibold text-amber-800">
                  {nuQueue[4]} unsaved draft{nuQueue[4] !== 1 ? "s" : ""} — not yet submitted for review.
                </p>
                <Link href="/maintenance/work-orders?status=Draft" className="shrink-0 rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-bold text-amber-700 transition hover:bg-amber-100">
                  View
                </Link>
              </div>
            )}

            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <QuickAction label="Create Job Card"       href="/maintenance/work-orders/new"  icon={PlusCircle}   iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Request Materials"     href="/store/parts-requests/new"      icon={ShoppingCart} iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Assets & Equipment"   href="/assets"                         icon={Gauge}        iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Spare Parts"          href="/store/parts"                    icon={Package}      iconBg="bg-green-50"  iconColor="text-green-600" />
            </div>

            {/* KPI Queue */}
            <section className="space-y-2">
              <SectionLabel>My Job Cards</SectionLabel>
              <KpiRow cols="sm:grid-cols-4" cards={[
                { label: "Awaiting Review",  value: nuQueue[0], icon: Clock,         tone: nuQueue[0] > 0 ? "blue"  : "gray",  href: "/maintenance/work-orders?status=Pending+Approval" },
                { label: "In Progress",      value: nuQueue[1], icon: Wrench,        tone: nuQueue[1] > 0 ? "blue"  : "gray",  href: "/maintenance/work-orders?status=In+Progress" },
                { label: "Waiting Parts",    value: nuQueue[2], icon: AlertTriangle, tone: nuQueue[2] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Waiting+for+Parts" },
                { label: "Returned for Fix", value: nuQueue[3], icon: AlertTriangle, tone: nuQueue[3] > 0 ? "red"   : "gray",  href: "/maintenance/work-orders?status=Rejected" },
              ]} />
            </section>

            {/* Latest Updates */}
            <ActivityList title="Latest Job Cards" viewAllHref="/maintenance/work-orders" empty={nuRecent.length === 0}>
              {nuRecent.map((row) => <WoRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── MAINTENANCE MANAGER ──────────────────────────────────── */}
        {isManager && mgQueue && (
          <>
            {/* Quick Actions — 6 items in 2-column / 3-column layout */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <QuickAction label="Review Job Cards"   href="/maintenance/work-orders?status=Pending+Approval" icon={ClipboardList} iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Materials Requests" href="/store/parts-requests"                            icon={ShoppingCart}  iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Assign Work"        href="/maintenance/work-orders?status=Pending+Approval" icon={Users}         iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Offline Inventory"  href="/store/offline-inventory"                         icon={Package}       iconBg="bg-amber-50"  iconColor="text-amber-600" />
              <QuickAction label="Service Contracts"  href="/assets/service-contracts"                        icon={FileText}      iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Reports"            href="/reports"                                          icon={BarChart3}     iconBg="bg-gray-100"  iconColor="text-[#4B5563]" />
            </div>

            {/* Manager Queue KPI */}
            <section className="space-y-2">
              <SectionLabel>Manager Queue</SectionLabel>
              <KpiRow cols="sm:grid-cols-3 xl:grid-cols-5" cards={[
                { label: "Awaiting Review",    value: mgQueue[0], icon: Clock,          tone: mgQueue[0] > 0 ? "red"   : "green", href: "/maintenance/work-orders?status=Pending+Approval" },
                { label: "Assigned",           value: mgQueue[1], icon: Users,          tone: "blue",                              href: "/maintenance/work-orders?status=Assigned" },
                { label: "In Progress",        value: mgQueue[2], icon: Wrench,         tone: mgQueue[2] > 0 ? "blue"  : "gray",  href: "/maintenance/work-orders?status=In+Progress" },
                { label: "Waiting Materials",  value: mgQueue[3], icon: AlertTriangle,  tone: mgQueue[3] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Waiting+for+Parts" },
                { label: "Awaiting Closure",   value: mgQueue[4], icon: CheckCircle2,   tone: mgQueue[4] > 0 ? "amber" : "green", href: "/maintenance/work-orders" },
              ]} />
            </section>

            {/* Needs Your Action — contextual action buttons */}
            <ActivityList title="Needs Your Action" viewAllHref="/maintenance/work-orders" empty={mgAction.length === 0}>
              {mgAction.map((row) => <ManagerActionRow key={row.id} row={row} />)}
            </ActivityList>

            {/* Materials Waiting — only shown when open requests exist */}
            {mgMaterials.length > 0 && (
              <ActivityList title="Materials Waiting" viewAllHref="/store/parts-requests" empty={false}>
                {mgMaterials.map((row) => <PrRow key={row.id} row={row} />)}
              </ActivityList>
            )}
          </>
        )}

        {/* ── TECHNICIAN ──────────────────────────────────────────── */}
        {isTechnician && techQueue && (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <QuickAction label="My Jobs"           href="/technician/jobs"          icon={Wrench}       iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Request Parts"     href="/store/parts-requests/new" icon={ShoppingCart} iconBg="bg-violet-50" iconColor="text-violet-600" />
              <QuickAction label="Upload Work Photo" href="/technician/jobs"          icon={Upload}       iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Notifications"     href="/notifications"            icon={Bell}         iconBg="bg-amber-50"  iconColor="text-amber-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>My Jobs</SectionLabel>
              <KpiRow cols="sm:grid-cols-4" cards={[
                { label: "Assigned",     value: techQueue[0], icon: ClipboardList, tone: techQueue[0] > 0 ? "blue"  : "gray",  href: "/technician/jobs" },
                { label: "In Progress",  value: techQueue[1], icon: Wrench,        tone: techQueue[1] > 0 ? "blue"  : "gray",  href: "/technician/jobs" },
                { label: "Waiting Parts",value: techQueue[2], icon: AlertTriangle, tone: techQueue[2] > 0 ? "amber" : "green", href: "/technician/jobs" },
                { label: "Completed",    value: techQueue[3], icon: CheckCircle2,  tone: techQueue[3] > 0 ? "green" : "gray",  href: "/technician/jobs" },
              ]} />
            </section>

            <ActivityList title="My Recent Jobs" viewAllHref="/technician/jobs" empty={techJobs.length === 0}>
              {techJobs.map((row) => <WoRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── STORE KEEPER ────────────────────────────────────────── */}
        {isStoreKeeper && skQueue && (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <QuickAction label="Materials Requests" href="/store/parts-requests" icon={ShoppingCart}  iconBg="bg-red-50"   iconColor="text-[#ED1C24]" />
              <QuickAction label="Spare Parts"    href="/store/parts"          icon={Package}       iconBg="bg-blue-50"  iconColor="text-blue-600" />
              <QuickAction label="Low Stock"      href="/store/low-stock"      icon={AlertTriangle} iconBg="bg-amber-50" iconColor="text-amber-600" />
              <QuickAction label="Notifications"  href="/notifications"        icon={Bell}          iconBg="bg-green-50" iconColor="text-green-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>Parts Queue</SectionLabel>
              <KpiRow cols="sm:grid-cols-4" cards={[
                { label: "Submitted Requests", value: skQueue[0], icon: ClipboardList, tone: skQueue[0] > 0 ? "red"   : "green", href: "/store/parts-requests?status=Waiting+for+Store" },
                { label: "Partially Issued",   value: skQueue[1], icon: Package,       tone: skQueue[1] > 0 ? "amber" : "green", href: "/store/parts-requests?status=Partially+Issued" },
                { label: "Low Stock Parts",    value: skQueue[2], icon: AlertTriangle, tone: skQueue[2] > 0 ? "amber" : "green", href: "/store/low-stock" },
                { label: "Waiting Purchase",   value: skQueue[3], icon: ShoppingCart,  tone: skQueue[3] > 0 ? "amber" : "gray",  href: "/store/parts-requests?status=Waiting+for+Purchase" },
              ]} />
            </section>

            <ActivityList title="Latest Materials Requests" viewAllHref="/store/parts-requests" empty={skRecent.length === 0}>
              {skRecent.map((row) => <PrRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── SUPER ADMIN ─────────────────────────────────────────── */}
        {isSuperAdmin && saCount && (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <QuickAction label="Create Job Card"     href="/maintenance/work-orders/new" icon={PlusCircle}  iconBg="bg-red-50"    iconColor="text-[#ED1C24]" />
              <QuickAction label="Assets & Equipment"  href="/assets"                      icon={Gauge}       iconBg="bg-blue-50"   iconColor="text-blue-600" />
              <QuickAction label="Spare Parts"         href="/store/parts"                 icon={Package}     iconBg="bg-green-50"  iconColor="text-green-600" />
              <QuickAction label="Users"               href="/admin/users"                 icon={Users}       iconBg="bg-violet-50" iconColor="text-violet-600" />
            </div>

            <section className="space-y-2">
              <SectionLabel>System Overview</SectionLabel>
              <KpiRow cols="sm:grid-cols-3 xl:grid-cols-5" cards={[
                { label: "Total Assets",      value: saCount[0], icon: Gauge,         tone: "blue",                              href: "/assets" },
                { label: "Open Job Cards",    value: saCount[1], icon: ClipboardList, tone: saCount[1] > 0 ? "amber" : "green", href: "/maintenance/work-orders" },
                { label: "Waiting Materials", value: saCount[2], icon: AlertTriangle, tone: saCount[2] > 0 ? "amber" : "green", href: "/maintenance/work-orders?status=Waiting+for+Parts" },
                { label: "Low Stock Parts",   value: saCount[3], icon: Package,       tone: saCount[3] > 0 ? "amber" : "green", href: "/store/low-stock" },
                { label: "Active Users",      value: saCount[4], icon: Users,         tone: "blue",                              href: "/admin/users" },
              ]} />
            </section>

            <ActivityList title="Latest Job Cards" viewAllHref="/maintenance/work-orders" empty={saRecent.length === 0}>
              {saRecent.map((row) => <WoRow key={row.id} row={row} />)}
            </ActivityList>
          </>
        )}

        {/* ── FALLBACK (viewer / auditor and other roles) ──────────── */}
        {!isNormalUser && !isManager && !isTechnician && !isStoreKeeper && !isSuperAdmin && (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <QuickAction label="Job Cards"          href="/maintenance/work-orders" icon={ClipboardList} iconBg="bg-blue-50"   iconColor="text-blue-600" />
            <QuickAction label="Reports"           href="/reports"                 icon={BarChart3}     iconBg="bg-green-50"  iconColor="text-green-600" />
            <QuickAction label="Assets & Equipment"href="/assets"                  icon={Gauge}         iconBg="bg-violet-50" iconColor="text-violet-600" />
            <QuickAction label="Notifications"     href="/notifications"           icon={Bell}          iconBg="bg-amber-50"  iconColor="text-amber-600" />
          </div>
        )}

      </div>

      {drawerData && <RepairOrderQuickView data={drawerData} />}
    </>
  );
}
