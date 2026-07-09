import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Gauge,
  PlusCircle,
  Wrench
} from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";
import { displayStatus } from "@/lib/display/work-order-labels";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";

type RecentWorkOrderRow = {
  id: string;
  work_order_number: string | null;
  operator_complaint: string | null;
  maintenance_type: string;
  status: string;
  priority: string;
  created_at: string;
  assets: { asset_code: string; asset_name: string } | null;
};

type AttentionAssetRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  condition: string | null;
  criticality: string | null;
  next_service_date: Date | null;
  status: string;
  category: string;
};

async function safeNum(query: Promise<number>): Promise<number> {
  try {
    return await query;
  } catch {
    return 0;
  }
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-black text-[#111827]">{title}</h2>
    </div>
  );
}

function woStatusTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (["Closed", "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) return "green";
  if (["Rejected", "Cancelled"].includes(status)) return "red";
  if (["Waiting for Parts", "Waiting for Purchase"].includes(status)) return "amber";
  if (status === "Draft") return "gray";
  return "blue";
}

function attentionReason(asset: AttentionAssetRow, today: Date): { label: string; tone: "red" | "amber" } {
  if (asset.condition === "Critical" || asset.criticality === "Critical") return { label: "Critical", tone: "red" };
  if (asset.condition === "Poor") return { label: "Poor Condition", tone: "amber" };
  if (asset.next_service_date && new Date(asset.next_service_date) < today) return { label: "Overdue Service", tone: "amber" };
  return { label: "Needs Attention", tone: "amber" };
}

const quickActions = [
  {
    label: "Create Repair Order",
    description: "Log a new breakdown or maintenance request",
    href: "/maintenance/work-orders/new",
    icon: PlusCircle,
    iconBg: "bg-red-50",
    iconColor: "text-[#ED1C24]",
    cardHover: "hover:border-[#ED1C24]/40 hover:shadow-red-100/60",
  },
  {
    label: "Add Asset",
    description: "Register a new machine or equipment",
    href: "/assets/new",
    icon: Gauge,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    cardHover: "hover:border-blue-300 hover:shadow-blue-100/60",
  },
  {
    label: "Import Assets",
    description: "Bulk upload assets from a spreadsheet",
    href: "/assets/import",
    icon: FileSpreadsheet,
    iconBg: "bg-green-50",
    iconColor: "text-green-600",
    cardHover: "hover:border-green-300 hover:shadow-green-100/60",
  },
  {
    label: "View Repair Orders",
    description: "Browse and filter all maintenance requests",
    href: "/maintenance/work-orders",
    icon: ClipboardList,
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    cardHover: "hover:border-violet-300 hover:shadow-violet-100/60",
  },
];

export default async function DashboardPage() {
  const context = await requireUser();
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const today = new Date();

  const roleSlug = context.role?.slug ?? "";
  const isPersonalScope = ["maintenance_data_entry", "department_requester", "technician"].includes(roleSlug);
  const showDraftAlert = ["maintenance_data_entry", "department_requester"].includes(roleSlug);

  const [
    totalAssets,
    totalWorkOrders,
    openWorkOrders,
    inProgressWorkOrders,
    waitingPartsWorkOrders,
    closedWorkOrders,
  ] = await Promise.all([
    safeNum(prisma.assets.count({ where: { deleted_at: null } })),
    safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter] } })),
    safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { notIn: ["Closed", "Rejected", "Cancelled"] } }] } })),
    safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: ["In Progress", "Parts Issued"] } }] } })),
    safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: { in: ["Waiting for Parts", "Waiting for Purchase"] } }] } })),
    safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Closed" }] } })),
  ]);

  const draftWorkOrders = showDraftAlert
    ? await safeNum(prisma.work_orders.count({ where: { AND: [{ deleted_at: null }, visibilityFilter, { status: "Draft" }] } }))
    : 0;

  const [recentWorkOrders, attentionAssets] = await Promise.all([
    prisma.work_orders
      .findMany({
        where: { AND: [{ deleted_at: null }, visibilityFilter] },
        select: {
          id: true,
          work_order_number: true,
          operator_complaint: true,
          maintenance_type: true,
          status: true,
          priority: true,
          created_at: true,
          assets: { select: { asset_code: true, asset_name: true } },
        },
        orderBy: { created_at: "desc" },
        take: 8,
      })
      .then((rows): RecentWorkOrderRow[] =>
        rows.map((r) => ({
          id: r.id,
          work_order_number: r.work_order_number,
          operator_complaint: r.operator_complaint,
          maintenance_type: r.maintenance_type,
          status: r.status,
          priority: r.priority,
          created_at: r.created_at.toISOString(),
          assets: Array.isArray(r.assets) ? (r.assets[0] ?? null) : r.assets,
        }))
      )
      .catch((): RecentWorkOrderRow[] => []),

    prisma.assets
      .findMany({
        where: {
          deleted_at: null,
          OR: [
            { condition: { in: ["Critical", "Poor"] } },
            { criticality: "Critical" },
            { next_service_date: { lt: today } },
          ],
        },
        select: {
          id: true,
          asset_code: true,
          asset_name: true,
          condition: true,
          criticality: true,
          next_service_date: true,
          status: true,
          category: true,
        },
        orderBy: { updated_at: "desc" },
        take: 6,
      })
      .catch((): AttentionAssetRow[] => []),
  ]);

  const kpiCards = [
    {
      label: "Total Assets",
      mobileLabel: "Assets",
      value: totalAssets,
      detail: "Active assets in the system",
      icon: Gauge,
      tone: "blue" as const,
      href: "/assets",
    },
    {
      label: "Total Repair Orders",
      mobileLabel: "Total ROs",
      value: totalWorkOrders,
      detail: "All repair orders visible to your role",
      icon: ClipboardList,
      tone: "blue" as const,
      href: "/maintenance/work-orders",
    },
    {
      label: "Open Repair Orders",
      mobileLabel: "Open",
      value: openWorkOrders,
      detail: "Active — not closed, rejected, or cancelled",
      icon: Wrench,
      tone: openWorkOrders > 0 ? ("amber" as const) : ("green" as const),
      href: "/maintenance/work-orders",
    },
    {
      label: "In Progress",
      mobileLabel: "In Progress",
      value: inProgressWorkOrders,
      detail: "Technicians actively working on these",
      icon: Wrench,
      tone: inProgressWorkOrders > 0 ? ("blue" as const) : ("gray" as const),
      href: "/maintenance/work-orders?status=In+Progress",
    },
    {
      label: "Waiting for Parts",
      mobileLabel: "Waiting",
      value: waitingPartsWorkOrders,
      detail: "Repair orders blocked by parts or purchase",
      icon: AlertTriangle,
      tone: waitingPartsWorkOrders > 0 ? ("red" as const) : ("green" as const),
      href: "/maintenance/work-orders?status=Waiting+for+Parts",
    },
    {
      label: "Closed",
      mobileLabel: "Closed",
      value: closedWorkOrders,
      detail: "Finalised and closed repair orders",
      icon: CheckCircle2,
      tone: "green" as const,
      href: "/maintenance/work-orders?status=Closed",
    },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Monitor assets, repair orders, machine condition, and maintenance activity."
      />
      <div className="space-y-6 p-4 pb-28 sm:p-6">

        {/* Quick Actions */}
        <section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className={`group flex items-center gap-3 rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${action.cardHover}`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${action.iconBg}`}>
                    <Icon className={`h-5 w-5 ${action.iconColor}`} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#111827]">{action.label}</p>
                    <p className="mt-0.5 truncate text-xs text-[#6B7280]">{action.description}</p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-[#D1D5DB] transition group-hover:translate-x-0.5 group-hover:text-[#6B7280]"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </div>
        </section>

        {/* KPI Cards */}
        <section className="space-y-4">
          <SectionTitle eyebrow="Overview" title="Maintenance Summary" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {kpiCards.map((card) => (
              <Link key={card.label} href={card.href} className="block">
                <StatCard
                  label={card.label}
                  mobileLabel={card.mobileLabel}
                  value={card.value}
                  detail={card.detail}
                  icon={card.icon}
                  tone={card.tone}
                />
              </Link>
            ))}
          </div>
        </section>

        {/* Assets Requiring Attention */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle eyebrow="Asset health" title="Assets Requiring Attention" />
            <Link href="/assets" className="inline-flex items-center gap-1.5 text-sm font-bold text-[#ED1C24] hover:text-[#c9151c]">
              View all assets
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          {attentionAssets.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {attentionAssets.map((asset) => {
                const reason = attentionReason(asset, today);
                const borderClass = reason.tone === "red"
                  ? "border-red-200 bg-red-50 hover:border-red-300"
                  : "border-amber-200 bg-amber-50 hover:border-amber-300";
                const badgeClass = reason.tone === "red"
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700";
                const iconClass = reason.tone === "red" ? "text-red-500" : "text-amber-500";
                return (
                  <Link
                    key={asset.id}
                    href={`/assets/${asset.id}`}
                    className={`flex items-start gap-3 rounded-md border p-4 shadow-sm transition ${borderClass}`}
                  >
                    <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-bold text-[#111827]">{asset.asset_name}</p>
                        <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${badgeClass}`}>{reason.label}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-[#4B5563]">{asset.asset_code} · {asset.category}</p>
                      {asset.next_service_date && new Date(asset.next_service_date) < today && (
                        <p className="mt-1 text-xs text-amber-700">
                          Service due: {new Date(asset.next_service_date).toLocaleDateString("en-GB")}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden="true" />
              <p className="text-sm font-semibold text-green-700">All assets are in good condition with no overdue service dates.</p>
            </div>
          )}
        </section>

        {/* Recent / My Repair Orders */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle
              eyebrow="Recent activity"
              title={isPersonalScope ? "My Repair Orders" : "Recent Repair Orders"}
            />
            <Link href="/maintenance/work-orders" className="inline-flex items-center gap-1.5 text-sm font-bold text-[#ED1C24] hover:text-[#c9151c]">
              View all
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {/* Draft alert for personal-scope users */}
          {showDraftAlert && draftWorkOrders > 0 && (
            <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="flex-1 text-sm font-semibold text-amber-800">
                {draftWorkOrders} unsaved draft{draftWorkOrders !== 1 ? "s" : ""} — not yet submitted for approval.
              </p>
              <Link
                href="/maintenance/work-orders?status=Draft"
                className="shrink-0 rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-bold text-amber-700 transition hover:bg-amber-100"
              >
                View Drafts
              </Link>
            </div>
          )}

          {/* Status quick-filter chips for personal-scope users */}
          {isPersonalScope && (
            <div className="flex flex-wrap gap-2">
              {[
                {
                  label: "Open",
                  count: openWorkOrders,
                  href: "/maintenance/work-orders",
                  cls: openWorkOrders > 0
                    ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                },
                {
                  label: "In Progress",
                  count: inProgressWorkOrders,
                  href: "/maintenance/work-orders?status=In+Progress",
                  cls: inProgressWorkOrders > 0
                    ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                },
                {
                  label: "Waiting for Parts",
                  count: waitingPartsWorkOrders,
                  href: "/maintenance/work-orders?status=Waiting+for+Parts",
                  cls: waitingPartsWorkOrders > 0
                    ? "bg-red-100 text-red-800 hover:bg-red-200"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                },
                {
                  label: "Closed",
                  count: closedWorkOrders,
                  href: "/maintenance/work-orders?status=Closed",
                  cls: "bg-green-100 text-green-800 hover:bg-green-200",
                },
              ].map((chip) => (
                <Link
                  key={chip.label}
                  href={chip.href}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition ${chip.cls}`}
                >
                  {chip.label}
                  <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-xs font-black tabular-nums">
                    {chip.count}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
            {recentWorkOrders.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-[#DDE2EA] bg-[#F8FAFC] text-left text-[11px] font-black uppercase tracking-wide text-[#4B5563]">
                      <th className="px-4 py-3">No.</th>
                      <th className="px-4 py-3">Asset / Machine</th>
                      <th className="px-4 py-3">Issue / Problem</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Priority</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2F6]">
                    {recentWorkOrders.map((wo) => {
                      const isUrgent = wo.priority === "Urgent";
                      const isRejected = wo.status === "Rejected";
                      const isWaiting = ["Waiting for Parts", "Waiting for Purchase"].includes(wo.status);
                      const isDraft = wo.status === "Draft";
                      const rowClass = isUrgent || isRejected
                        ? "bg-red-50/40 hover:bg-red-50"
                        : isWaiting
                          ? "bg-amber-50/40 hover:bg-amber-50"
                          : isDraft
                            ? "bg-gray-50/60 hover:bg-gray-50"
                            : "transition hover:bg-[#F8FAFC]";
                      const priorityTone = isUrgent ? "red" : wo.priority === "High" ? "amber" : "gray";
                      const issue = wo.operator_complaint ?? wo.maintenance_type ?? "—";
                      return (
                        <tr key={wo.id} className={rowClass}>
                          <td className="px-4 py-3 font-bold text-[#111827]">
                            {wo.work_order_number ?? (
                              <span className="text-xs font-medium italic text-[#9CA3AF]">Draft</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">
                            {wo.assets ? `${wo.assets.asset_code} – ${wo.assets.asset_name}` : "—"}
                          </td>
                          <td className="max-w-[200px] px-4 py-3 text-[#4B5563]">
                            <span className="block truncate" title={issue}>{issue}</span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge label={displayStatus(wo.status)} tone={woStatusTone(wo.status)} />
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge label={wo.priority} tone={priorityTone as "red" | "amber" | "gray"} />
                          </td>
                          <td className="px-4 py-3 text-xs text-[#4B5563]">{formatDateTime(wo.created_at)}</td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/maintenance/work-orders/${wo.id}`}
                              className="inline-block rounded-md border border-[#DDE2EA] px-3 py-1.5 text-xs font-bold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
                            >
                              {isDraft ? "Continue" : "View"}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5F6F8]">
                  <FileSpreadsheet className="h-6 w-6 text-[#9CA3AF]" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#374151]">No repair orders yet</p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">Start by creating your first maintenance request.</p>
                </div>
                <Link
                  href="/maintenance/work-orders/new"
                  className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c9151c]"
                >
                  <PlusCircle className="h-4 w-4" aria-hidden="true" />
                  Create Repair Order
                </Link>
              </div>
            )}
          </div>
        </section>

      </div>
    </>
  );
}
