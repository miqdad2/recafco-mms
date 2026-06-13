import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  Gauge,
  Landmark,
  Package,
  PackageSearch,
  PlusCircle,
  Settings,
  ShieldCheck,
  ShoppingCart,
  RotateCcw,
  Users,
  UserPlus,
  Wrench
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { markNotificationsReadAction } from "@/app/actions/workflow";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";
import { getBackupInfo, getLatestBackup } from "@/lib/backup/status";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";
import type { PermissionKey } from "@/types/database";

type AuditRow = {
  id: string;
  action: string;
  summary: string;
  created_at: string;
};

type NotificationRow = {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
  entity_id: string | null;
};

type RecentRequestRow = {
  id: string;
  work_order_number: string | null;
  maintenance_type: string | null;
  status: string;
  updated_at: string;
  assets: { asset_name: string; asset_code: string } | { asset_name: string; asset_code: string }[] | null;
};

type ApprovalQueueRow = {
  id: string;
  work_order_number: string | null;
  ordered_by: string | null;
  priority: string | null;
  status: string;
  created_at: Date;
  maintenance_type: string | null;
  assets: { asset_code: string; asset_name: string } | null;
};

type CeoDecisionRow = {
  id: string;
  purchase_request_number: string | null;
  estimated_total: Prisma.Decimal | null;
  created_at: Date;
  status: string;
};

type DeptPerformanceRow = {
  dept_name: string;
  pending: bigint;
  in_progress: bigint;
  blocked: bigint;
  closed_month: bigint;
};

type DashboardTone = "green" | "amber" | "red" | "blue" | "gray";

async function safeNum(query: Promise<number>): Promise<number> {
  try {
    return await query;
  } catch {
    return 0;
  }
}


function daysOld(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-black text-[#111827]">{title}</h2>
    </div>
  );
}

function toneClasses(tone: DashboardTone) {
  return {
    green: "border-green-200 bg-green-50 text-green-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    gray: "border-gray-200 bg-gray-50 text-gray-700"
  }[tone];
}

function recentRequestTone(status: string): DashboardTone {
  if (["Closed", "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status)) return "green";
  if (status === "Rejected" || status === "Cancelled") return "red";
  if (status === "Pending Approval") return "amber";
  if (status === "Draft") return "gray";
  return "blue";
}

function RiskAlertCard({ label, count, description, stage, href, tone }: { label: string; count: number; description: string; stage: string; href: string; tone: DashboardTone }) {
  const borderClass = tone === "red" ? "border-red-200 bg-red-50 hover:border-red-300" : tone === "amber" ? "border-amber-200 bg-amber-50 hover:border-amber-300" : "border-green-200 bg-green-50 hover:border-green-300";
  const iconBg = tone === "red" ? "bg-red-100" : tone === "amber" ? "bg-amber-100" : "bg-green-100";
  const textColor = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-green-600";
  const textBold = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-green-700";
  const tagBg = tone === "red" ? "bg-red-100 text-red-700" : tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";
  return (
    <Link href={href} className={`flex items-start gap-3 rounded-md border p-4 shadow-sm transition ${borderClass}`}>
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
        {tone === "green"
          ? <CheckCircle2 className={`h-4 w-4 ${textColor}`} aria-hidden="true" />
          : <AlertTriangle className={`h-4 w-4 ${textColor}`} aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-2xl font-black ${textColor}`}>{count}</p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${tagBg}`}>{stage}</span>
        </div>
        <p className={`mt-0.5 text-sm font-bold ${textBold}`}>{label}</p>
        <p className={`mt-0.5 text-xs ${textColor}`}>{description}</p>
      </div>
    </Link>
  );
}

function CeoFinancialLine({ label, value, note, href, tone }: { label: string; value: string; note: string; href: string; tone: DashboardTone }) {
  const valueColor = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "blue" ? "text-[#2563EB]" : "text-[#16A34A]";
  return (
    <Link href={href} className="block rounded-md border border-[#EEF2F6] bg-[#F8FAFC] p-4 transition hover:border-[#DDE2EA]">
      <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">{label}</p>
      <p className={`mt-2 text-xl font-black ${valueColor}`}>{value}</p>
      <p className="mt-1 text-[10px] text-[#9CA3AF]">{note}</p>
    </Link>
  );
}

function CeoExecutiveDashboard({
  currency,
  ceoApprovalQueue,
  financeQueue,
  blockedOperations,
  oldestBlockedDays,
  highRiskWork,
  overdueHighRisk,
  maintenanceCostThisMonth,
  pendingCeoApprovalTotal,
  totalPurchaseEstimatedCost,
  waitingPartsWorkOrders,
  waitingPurchaseWorkOrders,
  lowStockCount,
  completedThisMonth,
  decisionQueueRows,
  deptPerformance,
}: {
  currency: string;
  ceoApprovalQueue: number;
  financeQueue: number;
  blockedOperations: number;
  oldestBlockedDays: number;
  highRiskWork: number;
  overdueHighRisk: number;
  maintenanceCostThisMonth: number;
  pendingCeoApprovalTotal: number;
  totalPurchaseEstimatedCost: number;
  waitingPartsWorkOrders: number;
  waitingPurchaseWorkOrders: number;
  lowStockCount: number;
  completedThisMonth: number;
  decisionQueueRows: CeoDecisionRow[];
  deptPerformance: DeptPerformanceRow[];
}) {
  const hasActions = ceoApprovalQueue > 0;
  const hasRisk = blockedOperations > 0 || highRiskWork > 0;
  const overallStatus = hasActions ? "Action Required" : hasRisk ? "Monitor Closely" : "Operations Stable";
  const statusTone: DashboardTone = hasActions ? "red" : hasRisk ? "amber" : "green";

  return (
    <section className="hidden space-y-5 lg:block">
      {/* Executive Header */}
      <div className="rounded-md border border-[#111827] bg-[#111827] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-gray-400">Executive Dashboard</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-black text-white">CEO Executive Dashboard</h2>
              <span className={`rounded-md border px-2.5 py-1 text-xs font-black ${toneClasses(statusTone)}`}>{overallStatus}</span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
              Review critical approvals, blocked operations, cost exposure, and high-risk maintenance items.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/ceo/approvals" className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-[#c9151c]">
              <Landmark className="h-4 w-4" aria-hidden="true" />
              CEO Approvals
              {ceoApprovalQueue > 0 && (
                <span className="ml-0.5 rounded-full bg-white px-2 py-0.5 text-xs font-black text-[#ED1C24]">{ceoApprovalQueue}</span>
              )}
            </Link>
            <Link href="/reports/work-orders?report=cost-exposure" className="inline-flex items-center gap-2 rounded-md border border-gray-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Cost Reports
            </Link>
            <span className="hidden h-5 w-px bg-gray-600 sm:block" aria-hidden="true" />
            <Link href="/maintenance/work-orders" className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:text-gray-200">
              <ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Work Orders
            </Link>
            <Link href="/purchase/requests" className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:text-gray-200">
              <ShoppingCart className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Purchase
            </Link>
          </div>
        </div>
      </div>

      {/* 4 Executive Summary Cards */}
      <div className="grid gap-4 xl:grid-cols-4">
        {/* A. Needs CEO Decision */}
        <Link href="/ceo/approvals" className="block">
          <div className={`h-full rounded-md border p-5 shadow-sm transition ${ceoApprovalQueue > 0 ? "border-red-300 bg-red-50 hover:border-red-400" : "border-[#DDE2EA] bg-white hover:border-[#C9D0DA]"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${ceoApprovalQueue > 0 ? "bg-red-100" : "bg-gray-100"}`}>
                <Landmark className={`h-4 w-4 ${ceoApprovalQueue > 0 ? "text-red-600" : "text-gray-500"}`} aria-hidden="true" />
              </div>
              <span className={`rounded-md border px-2 py-1 text-xs font-black ${ceoApprovalQueue > 0 ? "border-red-200 bg-red-100 text-red-700" : "border-green-200 bg-green-100 text-green-700"}`}>
                {ceoApprovalQueue > 0 ? "Action Required" : "Clear"}
              </span>
            </div>
            <p className="mt-4 text-4xl font-black text-[#111827]">{ceoApprovalQueue}</p>
            <p className="mt-1 text-sm font-bold text-[#111827]">Needs CEO Decision</p>
            <p className="mt-1 text-xs leading-5 text-[#4B5563]">Purchase requests waiting for your final approval.</p>
            {ceoApprovalQueue === 0 && <p className="mt-3 text-xs italic text-green-600">No CEO approvals waiting. Operations are clear for final decision.</p>}
          </div>
        </Link>

        {/* B. Blocked Operations */}
        <Link href="/maintenance/work-orders?status=Waiting+for+Parts" className="block">
          <div className={`h-full rounded-md border p-5 shadow-sm transition ${blockedOperations > 0 ? "border-orange-200 bg-orange-50 hover:border-orange-300" : "border-[#DDE2EA] bg-white hover:border-[#C9D0DA]"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${blockedOperations > 0 ? "bg-orange-100" : "bg-gray-100"}`}>
                <AlertTriangle className={`h-4 w-4 ${blockedOperations > 0 ? "text-orange-600" : "text-gray-500"}`} aria-hidden="true" />
              </div>
              <span className={`rounded-md border px-2 py-1 text-xs font-black ${blockedOperations > 0 ? "border-orange-200 bg-orange-100 text-orange-700" : "border-green-200 bg-green-100 text-green-700"}`}>
                {blockedOperations > 0 ? "Blocked" : "Clear"}
              </span>
            </div>
            <p className="mt-4 text-4xl font-black text-[#111827]">{blockedOperations}</p>
            <p className="mt-1 text-sm font-bold text-[#111827]">Blocked Operations</p>
            <p className="mt-1 text-xs leading-5 text-[#4B5563]">
              Work orders blocked by parts, store, or purchase.
              {oldestBlockedDays > 0 && ` Oldest: ${oldestBlockedDays}d waiting.`}
            </p>
          </div>
        </Link>

        {/* C. High Risk Work */}
        <Link href="/maintenance/work-orders" className="block">
          <div className={`h-full rounded-md border p-5 shadow-sm transition ${highRiskWork > 0 ? "border-amber-200 bg-amber-50 hover:border-amber-300" : "border-[#DDE2EA] bg-white hover:border-[#C9D0DA]"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${highRiskWork > 0 ? "bg-amber-100" : "bg-gray-100"}`}>
                <ShieldCheck className={`h-4 w-4 ${highRiskWork > 0 ? "text-amber-600" : "text-gray-500"}`} aria-hidden="true" />
              </div>
              <span className={`rounded-md border px-2 py-1 text-xs font-black ${highRiskWork > 0 ? "border-amber-200 bg-amber-100 text-amber-700" : "border-green-200 bg-green-100 text-green-700"}`}>
                {highRiskWork > 0 ? "Watch" : "Clear"}
              </span>
            </div>
            <p className="mt-4 text-4xl font-black text-[#111827]">{highRiskWork}</p>
            <p className="mt-1 text-sm font-bold text-[#111827]">High Risk Work</p>
            <p className="mt-1 text-xs leading-5 text-[#4B5563]">
              High or urgent work orders not closed.
              {overdueHighRisk > 0 && ` ${overdueHighRisk} overdue.`}
            </p>
            {highRiskWork === 0 && <p className="mt-3 text-xs italic text-green-600">No high-risk maintenance items currently open.</p>}
          </div>
        </Link>

        {/* D. Recorded Cost Exposure */}
        <Link href="/reports/work-orders?report=cost-exposure" className="block">
          <div className="h-full rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm transition hover:border-[#C9D0DA]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50">
                <FileSpreadsheet className="h-4 w-4 text-[#2563EB]" aria-hidden="true" />
              </div>
              <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">Info</span>
            </div>
            <p className="mt-4 text-2xl font-black text-[#111827]">
              {maintenanceCostThisMonth.toLocaleString("en-US", { maximumFractionDigits: 0 })}{" "}
              <span className="text-base font-bold text-[#4B5563]">{currency}</span>
            </p>
            <p className="mt-1 text-sm font-bold text-[#111827]">Recorded Cost Exposure This Month</p>
            <p className="mt-1 text-xs leading-5 text-[#4B5563]">
              {pendingCeoApprovalTotal > 0
                ? `Pending executive approval: ${pendingCeoApprovalTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}.`
                : "No high-value items pending executive approval."}
            </p>
            <p className="mt-2 text-[10px] text-[#9CA3AF]">Recorded cost summary only. Detailed validation handled by Accounting / Cost Controller.</p>
          </div>
        </Link>
      </div>

      {/* CEO Approval Banner */}
      {ceoApprovalQueue > 0 && (
        <Link
          href="/ceo/approvals"
          className="flex items-center justify-between gap-4 rounded-md border-2 border-[#ED1C24] bg-[#ED1C24] px-5 py-4 text-white shadow-sm transition hover:bg-[#c9151c]"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-base font-black">
                {ceoApprovalQueue} purchase request{ceoApprovalQueue !== 1 ? "s" : ""} need{ceoApprovalQueue === 1 ? "s" : ""} your final approval
              </p>
              <p className="text-sm opacity-80">These have passed finance review. Your decision is the final step before procurement.</p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-white px-4 py-2 text-sm font-black text-[#ED1C24]">
            Review Now
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Link>
      )}

      {/* Executive Decision Queue */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle eyebrow="Needs executive attention" title="Executive Decision Queue" />
          {decisionQueueRows.length > 0 && (
            <Link href="/ceo/approvals" className="inline-flex items-center gap-1.5 text-sm font-bold text-[#ED1C24] hover:text-[#c9151c]">
              View all
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
        {decisionQueueRows.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[#DDE2EA] bg-[#F8FAFC] text-left text-[11px] font-black uppercase tracking-wide text-[#4B5563]">
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Reference No.</th>
                    <th className="px-4 py-3">Description / Reason</th>
                    <th className="px-4 py-3">Amount ({currency})</th>
                    <th className="px-4 py-3">Waiting Since</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6]">
                  {decisionQueueRows.map((row) => (
                    <tr key={row.id} className="transition hover:bg-[#FFF5F5]">
                      <td className="px-4 py-3">
                        <span className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">Purchase</span>
                      </td>
                      <td className="px-4 py-3 font-bold text-[#111827]">{row.purchase_request_number ?? "—"}</td>
                      <td className="px-4 py-3 text-[#4B5563]">Pending CEO approval</td>
                      <td className="px-4 py-3 font-bold text-[#111827]">
                        {row.estimated_total != null
                          ? parseFloat(row.estimated_total.toString()).toLocaleString("en-US", { maximumFractionDigits: 0 })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4B5563]">{daysOld(row.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/purchase/requests/${row.id}`} className="inline-block rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#c9151c]">
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-green-200 bg-green-50 p-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" aria-hidden="true" />
            <p className="mt-3 font-bold text-green-700">No CEO approvals waiting.</p>
            <p className="mt-1 text-sm text-green-600">Operations are clear for final decision. All purchase requests are within finance authority.</p>
          </div>
        )}
      </div>

      {/* Operational Risk Alerts */}
      <div className="space-y-3">
        <SectionTitle eyebrow="Operational risk" title="Operational Risk Alerts" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <RiskAlertCard label="Waiting for Parts" count={waitingPartsWorkOrders} description="Jobs blocked — parts not issued by store." stage="Store / Inventory" href="/maintenance/work-orders?status=Waiting+for+Parts" tone={waitingPartsWorkOrders > 0 ? "red" : "green"} />
          <RiskAlertCard label="Waiting for Purchase" count={waitingPurchaseWorkOrders} description="Jobs blocked by procurement workflow." stage="Purchase Department" href="/maintenance/work-orders?status=Waiting+for+Purchase" tone={waitingPurchaseWorkOrders > 0 ? "red" : "green"} />
          <RiskAlertCard label="Waiting for Finance" count={financeQueue} description="Cost approvals pending in finance or CEO workflow." stage="Finance Department" href="/finance/approvals" tone={financeQueue > 0 ? "amber" : "green"} />
          <RiskAlertCard label="Overdue High/Urgent Jobs" count={overdueHighRisk} description="High or urgent jobs running past planned start date." stage="Maintenance Team" href="/maintenance/work-orders" tone={overdueHighRisk > 0 ? "red" : "green"} />
          <RiskAlertCard label="Low Stock Parts" count={lowStockCount} description="Inventory items at or below minimum stock threshold." stage="Store / Inventory" href="/store/low-stock" tone={lowStockCount > 5 ? "red" : lowStockCount > 0 ? "amber" : "green"} />
          <RiskAlertCard label="CEO Decisions Pending" count={ceoApprovalQueue} description="High-value requests requiring your executive approval." stage="Executive" href="/ceo/approvals" tone={ceoApprovalQueue > 0 ? "red" : "green"} />
        </div>
      </div>

      {/* Financial Snapshot + Department Performance */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-3">
          <SectionTitle eyebrow="Executive cost summary" title="Financial Snapshot" />
          <div className="grid gap-3 sm:grid-cols-2">
            <CeoFinancialLine label="Recorded Maintenance Cost" value={`${maintenanceCostThisMonth.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`} note="Recorded cost — validated by Accounting / Cost Controller" href="/reports/work-orders?report=cost-exposure" tone="blue" />
            <CeoFinancialLine label="Pending Purchase Value" value={`${totalPurchaseEstimatedCost.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`} note="Estimated — all active purchase requests in workflow" href="/purchase/requests" tone={totalPurchaseEstimatedCost > 0 ? "amber" : "green"} />
            <CeoFinancialLine label="CEO Approval Value" value={`${pendingCeoApprovalTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`} note="Total value awaiting your final decision" href="/ceo/approvals" tone={pendingCeoApprovalTotal > 0 ? "red" : "green"} />
            <CeoFinancialLine label="Closed This Month" value={`${completedThisMonth} work orders`} note="Finalized and closed maintenance work this month" href="/reports/work-orders" tone="green" />
          </div>
        </div>

        <div className="space-y-3">
          <SectionTitle eyebrow="Cross-department" title="Department Performance" />
          <div className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
            {deptPerformance.length > 0 ? (
              <div className="space-y-3">
                {deptPerformance.map((dept) => {
                  const pending = Number(dept.pending);
                  const blocked = Number(dept.blocked);
                  const closedMonth = Number(dept.closed_month);
                  return (
                    <div key={dept.dept_name} className="flex items-center justify-between gap-4 border-b border-[#EEF2F6] pb-3 last:border-b-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#111827]">{dept.dept_name}</p>
                        <p className="mt-0.5 text-xs text-[#4B5563]">
                          {closedMonth > 0 && <span className="text-green-600">{closedMonth} closed this month</span>}
                          {closedMonth === 0 && pending === 0 && blocked === 0 && <span className="text-gray-400">No active work orders</span>}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {blocked > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">{blocked} blocked</span>}
                        {pending > 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{pending} pending</span>}
                        {blocked === 0 && pending === 0 && closedMonth > 0 && <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">clear</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[#4B5563]">No department work order data available.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SystemStatusCard({
  label, value, detail, tone, icon: Icon, href
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: DashboardTone;
  icon: LucideIcon;
  href?: string;
}) {
  const iconBg = { green: "bg-green-50", amber: "bg-amber-50", red: "bg-red-50", blue: "bg-blue-50", gray: "bg-gray-50" }[tone];
  const iconColor = { green: "text-green-600", amber: "text-amber-600", red: "text-red-600", blue: "text-[#2563EB]", gray: "text-gray-400" }[tone];
  const dotColor = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500", blue: "bg-blue-500", gray: "bg-gray-400" }[tone];
  const card = (
    <div className="flex items-start gap-3 rounded-md border border-[#DDE2EA] bg-white p-3 shadow-sm transition hover:border-[#C9D0DA]">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
          <p className="truncate text-[10px] font-black uppercase tracking-wide text-[#4B5563]">{label}</p>
        </div>
        <p className="mt-0.5 text-lg font-black leading-tight text-[#111827]">{value}</p>
        <p className="mt-0.5 truncate text-[11px] leading-4 text-[#9CA3AF]">{detail}</p>
      </div>
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

export default async function DashboardPage() {
  const context = await requireUser();
  const [
    profiles,
    activeDepartments,
    roles,
    auditLogs,
    settings,
    pendingApprovals,
    assignedJobs,
    unreadNotifications,
    pendingParts,
    lowStockCount,
    pendingPurchases,
    financeQueue,
    submittedWorkOrders,
    inProgressWorkOrders,
    waitingPartsWorkOrders,
    closedWorkOrders,
    totalWorkOrders,
    assignedWorkOrders,
    completedWorkOrders,
    totalAssets,
    totalParts,
    myDraftWorkOrders,
    mySubmittedWorkOrders,
    myPendingApprovalWorkOrders,
    myRejectedWorkOrders,
    myClosedWorkOrders,
    myTotalWorkOrders,
    _approvedWorkOrders,
    _managerCompletedAwaitingClosure,
    _supervisorVerificationQueue,
    overdueWorkOrders,
    _pendingPartsApprovals,
    ceoApprovalQueue,
    highPriorityWorkOrders,
    completedThisMonth,
    waitingPurchaseWorkOrders,
    totalMaintenanceCost,
    approvedCostRequests,
    rejectedCostRequests,
    approvedCostsThisMonth,
    rejectedCostsThisMonth,
    totalPurchaseEstimatedCost
  ] = await Promise.all([
    safeNum(prisma.profiles.count()),
    safeNum(prisma.departments.count({ where: { is_active: true } })),
    safeNum(prisma.roles.count()),
    safeNum(prisma.audit_logs.count()),
    prisma.app_settings.findUnique({ where: { id: "00000000-0000-0000-0000-000000000001" }, select: { default_currency: true } }).catch(() => null),
    safeNum(prisma.work_orders.count({ where: { status: { in: ["Submitted", "Pending Approval"] } } })),
    safeNum(prisma.work_order_assignments.count({ where: { technician_id: context.userId } })),
    safeNum(prisma.notifications.count({ where: { OR: [{ recipient_user_id: context.userId }, { recipient_id: context.userId }], archived_at: null, read_at: null, is_read: false } })),
    safeNum(prisma.parts_requests.count({ where: { status: { in: ["Pending Approval", "Waiting for Store", "Partially Issued", "Waiting for Purchase"] } } })),
    safeNum(prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*)::bigint AS count FROM public.parts WHERE deleted_at IS NULL AND current_stock <= minimum_stock`.then((rows) => Number(rows[0]?.count ?? 0))),
    safeNum(prisma.purchase_requests.count({ where: { status: { in: ["Pending Purchase", "Approved", "Ordered"] } } })),
    safeNum(prisma.purchase_requests.count({ where: { status: { in: ["Pending Finance Approval", "Pending CEO Approval"] } } })),
    safeNum(prisma.work_orders.count({ where: { status: { in: ["Submitted", "Pending Approval", "Approved", "Assigned"] } } })),
    safeNum(prisma.work_orders.count({ where: { status: "In Progress" } })),
    safeNum(prisma.work_orders.count({ where: { status: { in: ["Waiting for Parts", "Waiting for Purchase", "Parts Issued"] } } })),
    safeNum(prisma.work_orders.count({ where: { status: "Closed" } })),
    safeNum(prisma.work_orders.count()),
    safeNum(prisma.work_orders.count({ where: { status: "Assigned" } })),
    safeNum(prisma.work_orders.count({ where: { status: { in: ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"] } } })),
    safeNum(prisma.assets.count({ where: { deleted_at: null } })),
    safeNum(prisma.parts.count({ where: { deleted_at: null } })),
    safeNum(prisma.work_orders.count({ where: { created_by: context.userId, status: "Draft" } })),
    safeNum(prisma.work_orders.count({ where: { created_by: context.userId, status: "Submitted" } })),
    safeNum(prisma.work_orders.count({ where: { created_by: context.userId, status: "Pending Approval" } })),
    safeNum(prisma.work_orders.count({ where: { created_by: context.userId, status: "Rejected" } })),
    safeNum(prisma.work_orders.count({ where: { created_by: context.userId, status: "Closed" } })),
    safeNum(prisma.work_orders.count({ where: { created_by: context.userId } })),
    safeNum(prisma.work_orders.count({ where: { status: "Approved" } })),
    safeNum(prisma.work_orders.count({ where: { status: { in: ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"] } } })),
    safeNum(prisma.work_orders.count({ where: { status: "Completed by Technician" } })),
    safeNum(prisma.work_orders.count({ where: { starting_datetime: { lt: new Date() }, status: { in: ["Approved", "Assigned", "In Progress", "Waiting for Parts", "Waiting for Purchase"] } } })),
    safeNum(prisma.parts_requests.count({ where: { status: "Pending Approval" } })),
    safeNum(prisma.purchase_requests.count({ where: { status: "Pending CEO Approval" } })),
    safeNum(prisma.work_orders.count({ where: { priority: { in: ["High", "Urgent"] }, status: { notIn: ["Closed", "Cancelled", "Rejected"] } } })),
    safeNum(prisma.work_orders.count({ where: { status: "Closed", updated_at: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } })),
    safeNum(prisma.work_orders.count({ where: { status: "Waiting for Purchase" } })),
    safeNum(prisma.work_orders.aggregate({ _sum: { total_work_order_cost: true }, where: { status: { notIn: ["Cancelled", "Rejected"] } } }).then((r) => Number(r._sum.total_work_order_cost ?? 0))),
    safeNum(prisma.purchase_requests.count({ where: { status: { in: ["Approved", "Ordered", "Received"] } } })),
    safeNum(prisma.purchase_requests.count({ where: { status: "Rejected" } })),
    safeNum(prisma.purchase_requests.count({ where: { status: { in: ["Approved", "Ordered", "Received"] }, updated_at: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } })),
    safeNum(prisma.purchase_requests.count({ where: { status: "Rejected", updated_at: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } })),
    safeNum(prisma.purchase_requests.aggregate({ _sum: { estimated_total: true }, where: { status: { notIn: ["Cancelled", "Rejected"] } } }).then((r) => Number(r._sum.estimated_total ?? 0)))
  ]);

  // Security and system status — fast queries, run after main data
  const [activeSessions, lockedAccounts, failedLoginsToday, latestBackup] = await Promise.all([
    safeNum(prisma.auth_sessions.count({ where: { revoked_at: null, expires_at: { gt: new Date() } } })),
    safeNum(
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count FROM public.auth_users WHERE locked_until > now()
      `.then((rows) => Number(rows[0]?.count ?? 0))
    ),
    safeNum(
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count FROM public.auth_users WHERE failed_login_count > 0
      `.then((rows) => Number(rows[0]?.count ?? 0))
    ),
    getLatestBackup()
  ]);
  // If the page rendered successfully the database is reachable
  const dbOnline = true;

  const roleSlug = context.role?.slug;
  const isSuperAdmin = roleSlug === "super_admin";
  const isMaintenanceDataEntry = roleSlug === "maintenance_data_entry";
  const isMaintenanceManager = roleSlug === "maintenance_manager";
  const isCeoManagement = roleSlug === "ceo_management";
  const isFinanceManager = roleSlug === "finance_manager";
  const isCostController = roleSlug === "cost_controller";
  const isAccountingReviewer = roleSlug === "accounting_reviewer";
  const currency = settings?.default_currency ?? "KWD";
  const hasPermission = (permission: PermissionKey) => context.role?.slug === "super_admin" || context.permissions.includes(permission);
  const defaultQuickActions = [
    {
      label: "New Work Order",
      href: "/maintenance/work-orders/new",
      icon: PlusCircle,
      visible: hasPermission("work_orders.manage")
    },
    {
      label: "Work Orders",
      href: "/maintenance/work-orders",
      icon: ClipboardList,
      visible: isMaintenanceDataEntry && hasPermission("work_orders.view")
    },
    {
      label: "Pending Approvals",
      href: "/maintenance/approvals",
      icon: ClipboardCheck,
      visible: hasPermission("work_orders.approve")
    },
    {
      label: "My Jobs",
      href: "/technician/jobs",
      icon: Wrench,
      visible: hasPermission("technician.jobs.view")
    },
    {
      label: "Parts Requests",
      href: "/store/parts-requests",
      icon: PackageSearch,
      visible: hasPermission("parts_requests.view")
    }
  ].filter((item) => item.visible);

  // Department-scoped counts for Maintenance Manager (filtered to manager's dept)
  const mgrDeptId = isMaintenanceManager ? (context.department?.id ?? null) : null;
  const mgrBaseWhere: Prisma.work_ordersWhereInput = mgrDeptId
    ? { requested_by_department_id: mgrDeptId, deleted_at: null }
    : { created_by: context.userId, deleted_at: null };
  const mgrPartsBaseWhere: Prisma.parts_requestsWhereInput = mgrDeptId
    ? { work_orders: { requested_by_department_id: mgrDeptId, deleted_at: null } }
    : { work_orders: { created_by: context.userId, deleted_at: null } };

  const mgrCountsRaw = isMaintenanceManager
    ? await Promise.all([
        safeNum(prisma.work_orders.count({ where: { ...mgrBaseWhere, status: { in: ["Submitted", "Pending Approval"] } } })),
        safeNum(prisma.parts_requests.count({ where: { ...mgrPartsBaseWhere, status: "Pending Approval" } })),
        safeNum(prisma.work_orders.count({ where: { ...mgrBaseWhere, status: { in: ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"] } } })),
        safeNum(prisma.work_orders.count({ where: { ...mgrBaseWhere, status: { in: ["Waiting for Parts", "Waiting for Purchase", "Parts Issued"] } } })),
        safeNum(prisma.work_orders.count({ where: { ...mgrBaseWhere, status: "In Progress" } })),
        safeNum(prisma.work_orders.count({ where: { ...mgrBaseWhere, status: "Approved" } })),
        safeNum(prisma.work_orders.count({ where: { ...mgrBaseWhere, status: "Assigned" } })),
        safeNum(prisma.work_orders.count({ where: { ...mgrBaseWhere, starting_datetime: { lt: new Date() }, status: { in: ["Approved", "Assigned", "In Progress", "Waiting for Parts", "Waiting for Purchase"] } } })),
        safeNum(prisma.work_orders.count({ where: { ...mgrBaseWhere, priority: { in: ["High", "Urgent"] }, status: { notIn: ["Closed", "Cancelled", "Rejected"] } } })),
        safeNum(prisma.work_orders.count({ where: mgrBaseWhere })),
        safeNum(prisma.parts_requests.count({ where: { ...mgrPartsBaseWhere, status: { in: ["Pending Approval", "Waiting for Store", "Partially Issued", "Waiting for Purchase"] } } }))
      ])
    : null;

  // CEO-specific data — only fetched for CEO role to avoid unnecessary DB calls
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [maintenanceCostThisMonth, pendingCeoApprovalTotal, overdueHighRisk, oldestBlockedDays] = isCeoManagement
    ? await Promise.all([
        safeNum(
          prisma.work_orders
            .aggregate({ _sum: { total_work_order_cost: true }, where: { status: { notIn: ["Cancelled", "Rejected"] }, updated_at: { gte: firstOfMonth }, deleted_at: null } })
            .then((r) => Number(r._sum.total_work_order_cost ?? 0))
        ),
        safeNum(
          prisma.purchase_requests
            .aggregate({ _sum: { estimated_total: true }, where: { status: "Pending CEO Approval" } })
            .then((r) => Number(r._sum.estimated_total ?? 0))
        ),
        safeNum(
          prisma.work_orders.count({
            where: { starting_datetime: { lt: new Date() }, priority: { in: ["High", "Urgent"] }, status: { notIn: ["Closed", "Cancelled", "Rejected"] }, deleted_at: null }
          })
        ),
        safeNum(
          prisma.work_orders
            .findFirst({ where: { status: { in: ["Waiting for Parts", "Waiting for Purchase", "Parts Issued"] }, deleted_at: null }, orderBy: { updated_at: "asc" }, select: { updated_at: true } })
            // eslint-disable-next-line react-hooks/purity
            .then((row) => (row?.updated_at ? Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 86_400_000) : 0))
        )
      ])
    : [0, 0, 0, 0];

  const ceoDecisionQueueRows: CeoDecisionRow[] = isCeoManagement
    ? await prisma.purchase_requests
        .findMany({ where: { status: "Pending CEO Approval" }, select: { id: true, purchase_request_number: true, estimated_total: true, created_at: true, status: true }, orderBy: { created_at: "asc" }, take: 8 })
        .catch((): CeoDecisionRow[] => [])
    : [];

  const deptPerformance: DeptPerformanceRow[] = isCeoManagement
    ? await prisma.$queryRaw<DeptPerformanceRow[]>`
        SELECT d.name as dept_name,
          COUNT(CASE WHEN wo.status IN ('Submitted','Pending Approval') THEN 1 END)::bigint as pending,
          COUNT(CASE WHEN wo.status IN ('In Progress','Assigned') THEN 1 END)::bigint as in_progress,
          COUNT(CASE WHEN wo.status IN ('Waiting for Parts','Waiting for Purchase','Parts Issued') THEN 1 END)::bigint as blocked,
          COUNT(CASE WHEN wo.status = 'Closed' AND wo.updated_at >= ${firstOfMonth} THEN 1 END)::bigint as closed_month
        FROM departments d
        LEFT JOIN work_orders wo ON wo.requested_by_department_id = d.id AND wo.deleted_at IS NULL
        WHERE d.is_active = true
        GROUP BY d.id, d.name
        HAVING COUNT(wo.id) > 0
        ORDER BY pending DESC, blocked DESC
        LIMIT 6
      `.catch((): DeptPerformanceRow[] => [])
    : [];

  // Cost Controller / Accounting Reviewer data — only fetched when role requires it
  const needsCostControllerData = isCostController || isAccountingReviewer;
  const [ccPendingReview, ccHighValueCount, ccTotalActiveValue] = needsCostControllerData
    ? await Promise.all([
        safeNum(
          prisma.purchase_requests
            .count({ where: { status: { in: ["Pending Purchase", "Pending Finance Approval", "Pending CEO Approval", "Approved"] } } })
            .then((n) => n)
        ),
        safeNum(
          prisma.purchase_requests
            .count({ where: { status: { notIn: ["Cancelled", "Rejected", "Received"] }, estimated_total: { gte: 500 } } })
            .then((n) => n)
        ),
        safeNum(
          prisma.purchase_requests
            .aggregate({ _sum: { estimated_total: true }, where: { status: { notIn: ["Cancelled", "Rejected", "Received"] } } })
            .then((r) => Number(r._sum.estimated_total ?? 0))
        )
      ])
    : [0, 0, 0];

  const mgrPendingApprovals = mgrCountsRaw?.[0] ?? 0;
  const mgrPendingPartsApprovals = mgrCountsRaw?.[1] ?? 0;
  const mgrAwaitingClosure = mgrCountsRaw?.[2] ?? 0;
  const mgrWaitingParts = mgrCountsRaw?.[3] ?? 0;
  const mgrInProgress = mgrCountsRaw?.[4] ?? 0;
  const mgrApproved = mgrCountsRaw?.[5] ?? 0;
  const mgrAssigned = mgrCountsRaw?.[6] ?? 0;
  const mgrOverdue = mgrCountsRaw?.[7] ?? 0;
  const mgrHighPriority = mgrCountsRaw?.[8] ?? 0;
  const mgrTotal = mgrCountsRaw?.[9] ?? 0;
  const mgrPendingParts = mgrCountsRaw?.[10] ?? 0;

  const managerQuickActions = [
    { label: "Pending Approvals", href: "/maintenance/approvals", icon: ClipboardCheck, visible: hasPermission("work_orders.approve") },
    { label: "Work Orders", href: "/maintenance/work-orders", icon: ClipboardList, visible: hasPermission("work_orders.view") },
    { label: "Parts Requests", href: "/store/parts-requests", icon: PackageSearch, visible: hasPermission("parts_requests.view") },
    { label: "Reports", href: "/reports/work-orders", icon: FileSpreadsheet, visible: hasPermission("reports.view") }
  ].filter((item) => item.visible);

  const ceoQuickActions = [
    { label: "CEO Approvals", href: "/ceo/approvals", icon: Landmark, visible: hasPermission("ceo.approve") },
    { label: "Cost Reports", href: "/reports/work-orders?report=cost-exposure", icon: FileSpreadsheet, visible: hasPermission("reports.view") || hasPermission("costs.view") },
    { label: "Work Orders", href: "/maintenance/work-orders", icon: ClipboardList, visible: hasPermission("work_orders.view") },
    { label: "Assets", href: "/assets", icon: Gauge, visible: hasPermission("assets.view") }
  ].filter((item) => item.visible);

  const financeQuickActions = [
    { label: "Finance Approvals", href: "/finance/approvals", icon: Landmark, visible: hasPermission("finance.approve") },
    { label: "Cost Reports", href: "/finance/reports", icon: FileSpreadsheet, visible: hasPermission("finance.reports.view") || hasPermission("reports.view") },
    { label: "Purchase Requests", href: "/purchase/requests", icon: ShoppingCart, visible: hasPermission("purchase_requests.view") },
    { label: "Export Costs", href: "/reports/costs", icon: FileSpreadsheet, visible: hasPermission("reports.view") || hasPermission("costs.view") }
  ].filter((item) => item.visible);

  const dataEntryMobileActions = [
    { label: "Create Request", href: "/maintenance/work-orders/new", icon: PlusCircle, visible: hasPermission("work_orders.manage") },
    { label: "My Requests", href: "/maintenance/work-orders", icon: ClipboardList, visible: hasPermission("work_orders.view") },
    { label: "Rejected / Fix", href: "/maintenance/work-orders?status=Rejected", icon: RotateCcw, visible: hasPermission("work_orders.view") }
  ].filter((item) => item.visible);

  const quickActions = isMaintenanceDataEntry
    ? dataEntryMobileActions
    : isMaintenanceManager
      ? managerQuickActions
      : isCeoManagement
        ? ceoQuickActions
        : isFinanceManager
          ? financeQuickActions
          : defaultQuickActions;

  const statusSummary = [
    { label: "Pending", value: submittedWorkOrders, tone: "amber" as const },
    { label: "Assigned", value: assignedWorkOrders, tone: "gray" as const },
    { label: "In Progress", value: inProgressWorkOrders, tone: "blue" as const },
    { label: "Waiting Parts", value: waitingPartsWorkOrders, tone: "red" as const },
    { label: "Completed", value: completedWorkOrders, tone: "green" as const },
    { label: "Closed", value: closedWorkOrders, tone: "green" as const }
  ];

  const financeStatusSummary = [
    { label: "Pending Finance", value: financeQueue, tone: "amber" as const },
    { label: "Pending CEO", value: ceoApprovalQueue, tone: "red" as const },
    { label: "Approved", value: approvedCostRequests, tone: "green" as const },
    { label: "Rejected", value: rejectedCostRequests, tone: "red" as const },
    { label: "Purchase Queue", value: pendingPurchases, tone: "blue" as const },
    { label: "Waiting Purchase", value: waitingPurchaseWorkOrders, tone: "amber" as const }
  ];

  const dataEntryMobileStatus = [
    { label: "Drafts", value: myDraftWorkOrders, tone: "gray" as const },
    { label: "Submitted", value: mySubmittedWorkOrders, tone: "blue" as const },
    { label: "Waiting Approval", value: myPendingApprovalWorkOrders, tone: "amber" as const },
    { label: "Rejected", value: myRejectedWorkOrders, tone: "red" as const },
    { label: "Closed", value: myClosedWorkOrders, tone: "green" as const }
  ];

  const mgrMobileStatus = [
    { label: "Need Approval", value: mgrPendingApprovals, tone: "amber" as const },
    { label: "In Progress", value: mgrInProgress, tone: "blue" as const },
    { label: "Waiting Parts", value: mgrWaitingParts, tone: "red" as const },
    { label: "Awaiting Closure", value: mgrAwaitingClosure, tone: "green" as const },
    { label: "Overdue", value: mgrOverdue, tone: "red" as const },
    { label: "High Priority", value: mgrHighPriority, tone: "amber" as const }
  ];

  const primaryStats = [
    { label: "Profiles", mobileLabel: "Profiles", value: profiles, detail: "Login-linked user profiles", icon: Users, tone: "blue" as const },
    { label: "Departments", mobileLabel: "Depts", value: activeDepartments, detail: "Operational departments", icon: Building2, tone: "green" as const },
    { label: "Approvals", mobileLabel: "Approvals", value: pendingApprovals, detail: "Work orders waiting for review", icon: ClipboardCheck, tone: "amber" as const },
    { label: "My Jobs", mobileLabel: "Jobs", value: assignedJobs, detail: "Technician assignment count", icon: Wrench, tone: "gray" as const }
  ];

  const secondaryStats = [
    { label: "Unread Notifications", mobileLabel: "Alerts", value: unreadNotifications, detail: "Current user notifications", icon: Bell, tone: "red" as const },
    { label: "Parts Queue", mobileLabel: "Parts", value: pendingParts, detail: "Approval, store, and purchase-linked requests", icon: PackageSearch, tone: "blue" as const },
    { label: "Low Stock", mobileLabel: "Low Stock", value: lowStockCount, detail: "Parts at or below minimum", icon: ShoppingCart, tone: "amber" as const },
    { label: "Purchase Queue", mobileLabel: "Purchase", value: pendingPurchases, detail: "Pending, approved, or ordered purchases", icon: ShoppingCart, tone: "blue" as const },
    { label: "Finance / CEO", mobileLabel: "Finance", value: financeQueue, detail: "Cost approvals requiring decision", icon: Landmark, tone: "red" as const },
    { label: "Roles", mobileLabel: "Roles", value: roles, detail: "Configured access groups", icon: ShieldCheck, tone: "green" as const },
    { label: "Audit Entries", mobileLabel: "Audit", value: auditLogs, detail: "Tracked admin actions", icon: Activity, tone: "gray" as const },
    { label: "Spare Parts", mobileLabel: "Parts", value: totalParts, detail: "Total parts in inventory master", icon: Package, tone: "blue" as const }
  ];

  const globalControlActions = [
    { label: "New Work Order", href: "/maintenance/work-orders/new", icon: PlusCircle, visible: hasPermission("work_orders.manage") },
    { label: "Add User", href: "/admin/users", icon: UserPlus, visible: hasPermission("admin.users.manage") },
    { label: "Departments", href: "/admin/departments", icon: Building2, visible: hasPermission("admin.departments.manage") },
    { label: "Add Asset", href: "/assets/new", icon: Gauge, visible: hasPermission("assets.manage") },
    { label: "Add Part", href: "/store/parts/new", icon: Package, visible: hasPermission("parts.manage") },
    { label: "Settings", href: "/admin/settings", icon: Settings, visible: hasPermission("admin.settings.manage") },
    { label: "Export Report", href: "/reports/work-orders", icon: FileSpreadsheet, visible: hasPermission("reports.view") }
  ].filter((item) => item.visible);

  const criticalStats = [
    { label: "Pending Approvals", mobileLabel: "Approvals", value: pendingApprovals, detail: "Work orders waiting for management review", icon: ClipboardCheck, tone: "amber" as const },
    { label: "Waiting for Parts", mobileLabel: "Waiting", value: waitingPartsWorkOrders, detail: "Work orders blocked by parts or purchase", icon: AlertTriangle, tone: "red" as const },
    { label: "Low Stock", mobileLabel: "Low Stock", value: lowStockCount, detail: "Inventory items at or below minimum", icon: ShoppingCart, tone: "amber" as const },
    { label: "Finance / CEO", mobileLabel: "Finance", value: financeQueue, detail: "Cost approvals requiring decision", icon: Landmark, tone: "red" as const },
    { label: "Unread Alerts", mobileLabel: "Alerts", value: unreadNotifications, detail: "Workflow notifications for this account", icon: Bell, tone: "red" as const }
  ];

  const operationStats = [
    { label: "Total Work Orders", mobileLabel: "Total WOs", value: totalWorkOrders, detail: "All maintenance work orders in the system", icon: ClipboardList, tone: "blue" as const },
    { label: "Open Work Orders", mobileLabel: "Open", value: submittedWorkOrders, detail: "Submitted, pending, approved, or assigned", icon: ClipboardCheck, tone: "amber" as const },
    { label: "In Progress", mobileLabel: "Active", value: inProgressWorkOrders, detail: "Jobs currently being worked on", icon: Wrench, tone: "blue" as const },
    { label: "Assigned Jobs", mobileLabel: "Assigned", value: assignedWorkOrders, detail: "Work orders assigned to technicians", icon: Users, tone: "gray" as const },
    { label: "Purchase Queue", mobileLabel: "Purchase", value: pendingPurchases, detail: "Pending, approved, or ordered purchases", icon: ShoppingCart, tone: "blue" as const },
    { label: "Parts Queue", mobileLabel: "Parts", value: pendingParts, detail: "Parts requests needing workflow action", icon: PackageSearch, tone: "blue" as const }
  ];

  const dataEntryOperationStats = [
    { label: "Open Work Orders", mobileLabel: "Open", value: submittedWorkOrders, detail: "Submitted, pending, approved, or assigned", icon: ClipboardCheck, tone: "amber" as const },
    { label: "Pending Approval", mobileLabel: "Pending", value: pendingApprovals, detail: "Work orders waiting for manager approval", icon: ClipboardCheck, tone: "amber" as const },
    { label: "In Progress", mobileLabel: "Active", value: inProgressWorkOrders, detail: "Jobs currently being worked on", icon: Wrench, tone: "blue" as const },
    { label: "Waiting for Parts", mobileLabel: "Waiting", value: waitingPartsWorkOrders, detail: "Work orders blocked by parts or purchase", icon: AlertTriangle, tone: "red" as const },
    { label: "Completed", mobileLabel: "Done", value: completedWorkOrders, detail: "Completed or verified work orders", icon: CheckCircle2, tone: "green" as const },
    { label: "Closed", mobileLabel: "Closed", value: closedWorkOrders, detail: "Finalized work orders", icon: CheckCircle2, tone: "green" as const }
  ];

  const failedLoginTone: DashboardTone = failedLoginsToday > 0 ? "amber" : "green";
  const lockedAccountTone: DashboardTone = lockedAccounts > 0 ? "amber" : "green";
  const backupInfo = getBackupInfo(latestBackup);

  const adminStats = [
    { label: "Profiles", mobileLabel: "Profiles", value: profiles, detail: "Login-linked user profiles", icon: Users, tone: "blue" as const },
    { label: "Departments", mobileLabel: "Depts", value: activeDepartments, detail: "Operational departments", icon: Building2, tone: "green" as const },
    { label: "Roles", mobileLabel: "Roles", value: roles, detail: "Configured access groups", icon: ShieldCheck, tone: "green" as const },
    { label: "Audit Entries", mobileLabel: "Audit", value: auditLogs, detail: "Tracked admin and workflow actions", icon: Activity, tone: "gray" as const },
    { label: "Active Sessions", mobileLabel: "Sessions", value: activeSessions, detail: "Non-expired authenticated sessions", icon: Users, tone: "blue" as const },
    { label: "Failed Logins", mobileLabel: "Failed", value: failedLoginsToday, detail: "Accounts with recent login failures", icon: ShieldCheck, tone: failedLoginTone },
    { label: "Locked Accounts", mobileLabel: "Locked", value: lockedAccounts, detail: "User accounts currently locked out", icon: AlertTriangle, tone: lockedAccountTone },
    { label: "Backup Status", mobileLabel: "Backup", value: backupInfo.value, detail: backupInfo.detail, icon: Settings, tone: backupInfo.tone }
  ];

  const dataEntryStats = [
    { label: "My Work Orders", mobileLabel: "My WOs", value: myTotalWorkOrders, detail: "Work orders created by your account", icon: ClipboardList, tone: "blue" as const },
    { label: "Drafts", mobileLabel: "Drafts", value: myDraftWorkOrders, detail: "Saved work orders not submitted yet", icon: FileSpreadsheet, tone: "gray" as const },
    { label: "Submitted", mobileLabel: "Submitted", value: mySubmittedWorkOrders, detail: "Submitted work orders waiting for workflow", icon: ClipboardCheck, tone: "blue" as const },
    { label: "Pending Approval", mobileLabel: "Pending", value: myPendingApprovalWorkOrders, detail: "Created work orders waiting for manager approval", icon: ClipboardCheck, tone: "amber" as const },
    { label: "Rejected", mobileLabel: "Rejected", value: myRejectedWorkOrders, detail: "Returned work orders needing correction", icon: RotateCcw, tone: "red" as const },
    { label: "Closed", mobileLabel: "Closed", value: myClosedWorkOrders, detail: "Your created work orders already closed", icon: CheckCircle2, tone: "green" as const }
  ];


  const managerDecisionStats = [
    { label: "WO Approvals", mobileLabel: "WO Review", value: mgrPendingApprovals, detail: "Department work orders needing manager approval", icon: ClipboardCheck, tone: "amber" as const },
    { label: "Parts Approvals", mobileLabel: "Parts", value: mgrPendingPartsApprovals, detail: "Parts requests needing maintenance approval", icon: PackageSearch, tone: "amber" as const },
    { label: "Awaiting Closure", mobileLabel: "Closure", value: mgrAwaitingClosure, detail: "Completed work orders ready for closure review", icon: CheckCircle2, tone: "green" as const },
    { label: "Waiting Parts / Purchase", mobileLabel: "Waiting", value: mgrWaitingParts, detail: "Department work orders blocked by parts or purchase", icon: AlertTriangle, tone: "red" as const },
    { label: "Urgent / High Priority", mobileLabel: "Priority", value: mgrHighPriority, detail: "High or urgent open work orders in department", icon: Bell, tone: "amber" as const },
    { label: "Overdue", mobileLabel: "Overdue", value: mgrOverdue, detail: "Open work orders past planned start date", icon: AlertTriangle, tone: "red" as const }
  ];

  const managerOperationStats = [
    { label: "Total (Dept)", mobileLabel: "Total", value: mgrTotal, detail: "All work orders in this department", icon: ClipboardList, tone: "blue" as const },
    { label: "Approved", mobileLabel: "Approved", value: mgrApproved, detail: "Approved jobs ready for supervisor assignment", icon: ShieldCheck, tone: "green" as const },
    { label: "Assigned", mobileLabel: "Assigned", value: mgrAssigned, detail: "Work orders assigned to technicians", icon: Users, tone: "gray" as const },
    { label: "In Progress", mobileLabel: "Active", value: mgrInProgress, detail: "Jobs currently being worked on", icon: Wrench, tone: "blue" as const },
    { label: "Waiting Parts", mobileLabel: "Waiting", value: mgrWaitingParts, detail: "Jobs blocked by parts workflow", icon: AlertTriangle, tone: "red" as const },
    { label: "Awaiting Closure", mobileLabel: "Closure", value: mgrAwaitingClosure, detail: "Completed or verified work orders", icon: CheckCircle2, tone: "green" as const }
  ];

  const managerWorkflowStats = [
    { label: "Supervisor Verification", mobileLabel: "Verify", value: mgrAwaitingClosure, detail: "Technician-completed jobs needing verification in dept", icon: ClipboardCheck, tone: "amber" as const },
    { label: "Technician Assignments", mobileLabel: "Team", value: mgrAssigned, detail: "Current assigned technician workload in department", icon: Users, tone: "gray" as const },
    { label: "Parts Request Queue", mobileLabel: "Parts", value: mgrPendingParts, detail: "Parts requests in approval or store workflow (dept)", icon: PackageSearch, tone: "blue" as const },
    { label: "Low Stock", mobileLabel: "Stock", value: lowStockCount, detail: "Inventory items at or below minimum", icon: ShoppingCart, tone: "amber" as const }
  ];

  const ceoAttentionStats = [
    { label: "CEO Approvals", mobileLabel: "CEO", value: ceoApprovalQueue, detail: "High-value requests waiting for executive decision", icon: Landmark, tone: "red" as const },
    { label: "Finance Queue", mobileLabel: "Finance", value: financeQueue, detail: "Finance or CEO approval requests still pending", icon: FileSpreadsheet, tone: "amber" as const },
    { label: "Overdue WOs", mobileLabel: "Overdue", value: overdueWorkOrders, detail: "Open work orders past planned start", icon: Bell, tone: "red" as const },
    { label: "Waiting Parts", mobileLabel: "Parts", value: waitingPartsWorkOrders, detail: "Maintenance work blocked by parts availability", icon: AlertTriangle, tone: "red" as const },
    { label: "High Priority", mobileLabel: "Priority", value: highPriorityWorkOrders, detail: "High or urgent work orders still open", icon: ClipboardCheck, tone: "amber" as const }
  ];

  const ceoOperationStats = [
    { label: "Open Work Orders", mobileLabel: "Open", value: submittedWorkOrders, detail: "Submitted, pending, approved, or assigned", icon: ClipboardCheck, tone: "amber" as const },
    { label: "Completed This Month", mobileLabel: "Month", value: completedThisMonth, detail: "Closed work orders during the current month", icon: CheckCircle2, tone: "green" as const },
    { label: "In Progress", mobileLabel: "Active", value: inProgressWorkOrders, detail: "Jobs currently being worked on", icon: Wrench, tone: "blue" as const },
    { label: "Waiting Purchase", mobileLabel: "Purchase", value: waitingPurchaseWorkOrders, detail: "Work orders blocked by purchase workflow", icon: ShoppingCart, tone: "red" as const },
    { label: "Closed", mobileLabel: "Closed", value: closedWorkOrders, detail: "Finalized work orders", icon: CheckCircle2, tone: "green" as const }
  ];

  const ceoRiskStats = [
    { label: "Maintenance Cost", mobileLabel: "Cost", value: `${totalMaintenanceCost.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`, detail: "Total recorded maintenance cost excluding cancelled/rejected work", icon: FileSpreadsheet, tone: "blue" as const },
    { label: "Low Stock Risk", mobileLabel: "Stock", value: lowStockCount, detail: "Inventory items at or below minimum", icon: ShoppingCart, tone: "amber" as const },
    { label: "Top Risk Assets", mobileLabel: "Assets", value: totalAssets, detail: "Asset base monitored for breakdown and service risk", icon: Gauge, tone: "gray" as const },
    { label: "Parts Queue", mobileLabel: "Parts", value: pendingParts, detail: "Parts requests affecting maintenance delivery", icon: PackageSearch, tone: "blue" as const }
  ];
  const financeActions = [
    { label: "Finance Approvals", href: "/finance/approvals", icon: Landmark, visible: hasPermission("finance.approve") },
    { label: "Cost Reports", href: "/finance/reports", icon: FileSpreadsheet, visible: hasPermission("finance.reports.view") || hasPermission("reports.view") },
    { label: "Purchase Requests", href: "/purchase/requests", icon: ShoppingCart, visible: hasPermission("purchase_requests.view") },
    { label: "Export Costs", href: "/reports/costs", icon: FileSpreadsheet, visible: hasPermission("reports.view") || hasPermission("costs.view") }
  ].filter((item) => item.visible);

  const financeDecisionStats = [
    { label: "Pending Finance", mobileLabel: "Finance", value: financeQueue, detail: "Requests waiting for finance or executive approval", icon: Landmark, tone: "amber" as const },
    { label: "Pending CEO", mobileLabel: "CEO", value: ceoApprovalQueue, detail: "High-value requests escalated for CEO approval", icon: ShieldCheck, tone: "red" as const },
    { label: "Approved Costs", mobileLabel: "Approved", value: approvedCostRequests, detail: "Approved, ordered, or received purchase requests", icon: CheckCircle2, tone: "green" as const },
    { label: "Rejected Costs", mobileLabel: "Rejected", value: rejectedCostRequests, detail: "Rejected purchase or cost requests", icon: RotateCcw, tone: "red" as const },
    { label: "Purchase Queue", mobileLabel: "Purchase", value: pendingPurchases, detail: "Pending, approved, or ordered purchases", icon: ShoppingCart, tone: "blue" as const }
  ];

  const financeCostStats = [
    { label: "Maintenance Cost", mobileLabel: "Maint Cost", value: `${totalMaintenanceCost.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`, detail: "Total recorded maintenance work order cost", icon: FileSpreadsheet, tone: "blue" as const },
    { label: "Purchase Estimated", mobileLabel: "Purchase", value: `${totalPurchaseEstimatedCost.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`, detail: "Estimated purchase request value in workflow", icon: ShoppingCart, tone: "amber" as const },
    { label: "Approved This Month", mobileLabel: "Approved", value: approvedCostsThisMonth, detail: "Cost requests approved, ordered, or received this month", icon: CheckCircle2, tone: "green" as const },
    { label: "Rejected This Month", mobileLabel: "Rejected", value: rejectedCostsThisMonth, detail: "Cost requests rejected during the current month", icon: RotateCcw, tone: "red" as const }
  ];

  const financeRiskStats = [
    { label: "Waiting Purchase", mobileLabel: "Purchase", value: waitingPurchaseWorkOrders, detail: "Work orders blocked by purchase workflow", icon: ShoppingCart, tone: "red" as const },
    { label: "Waiting Parts", mobileLabel: "Parts", value: waitingPartsWorkOrders, detail: "Maintenance work blocked by parts availability", icon: AlertTriangle, tone: "red" as const },
    { label: "Low Stock", mobileLabel: "Stock", value: lowStockCount, detail: "Inventory items at or below minimum", icon: PackageSearch, tone: "amber" as const },
    { label: "High Priority WOs", mobileLabel: "Priority", value: highPriorityWorkOrders, detail: "High or urgent work orders still open", icon: Bell, tone: "amber" as const }
  ];

  const workOrderFlowSummary = isMaintenanceManager
    ? [
        { label: "Pending", value: mgrPendingApprovals, tone: "amber" as const },
        { label: "Approved", value: mgrApproved, tone: "green" as const },
        { label: "Assigned", value: mgrAssigned, tone: "gray" as const },
        { label: "In Progress", value: mgrInProgress, tone: "blue" as const },
        { label: "Waiting Parts", value: mgrWaitingParts, tone: "red" as const },
        { label: "Awaiting Closure", value: mgrAwaitingClosure, tone: "green" as const }
      ]
    : statusSummary;
  const workOrderFlowTotal = isMaintenanceManager ? mgrTotal : totalWorkOrders;

  const visibleOperationStats = isMaintenanceDataEntry
    ? dataEntryOperationStats
    : isMaintenanceManager
      ? managerOperationStats
      : isCeoManagement
        ? ceoOperationStats
        : isFinanceManager
          ? financeCostStats
        : operationStats;
  const mobileStats = isMaintenanceDataEntry
    ? dataEntryStats
    : isMaintenanceManager
      ? [...managerDecisionStats, ...managerWorkflowStats]
      : isCeoManagement
        ? [...ceoAttentionStats, ...ceoRiskStats]
        : isFinanceManager
          ? [...financeDecisionStats, ...financeCostStats]
        : [...primaryStats, ...secondaryStats];
  const mobileStatusSummary = isFinanceManager ? financeStatusSummary : isMaintenanceDataEntry ? dataEntryMobileStatus : isMaintenanceManager ? mgrMobileStatus : statusSummary;
  const mobileStatusEyebrow = isFinanceManager ? "Finance" : isMaintenanceDataEntry ? "My requests" : isMaintenanceManager ? "Maintenance" : "Work orders";
  const mobileStatusTitle = isFinanceManager ? "Approval Status" : isMaintenanceDataEntry ? "My Request Status" : isMaintenanceManager ? "Department Workflow" : "Priority Status";

  const dashboardTitle = isMaintenanceDataEntry
    ? "Maintenance Data Entry Workspace"
    : isCeoManagement
      ? "CEO Executive Dashboard"
      : isCostController
        ? "Cost Controller Dashboard"
        : isAccountingReviewer
          ? "Accounting Review Dashboard"
          : "Dashboard";

  const dashboardDescription = isMaintenanceDataEntry
    ? "Create, submit, and track your maintenance forms."
    : isMaintenanceManager
      ? "Review approvals, control maintenance workflow, and monitor department work orders."
    : isCeoManagement
      ? "Executive maintenance monitoring for approvals, cost, delays, asset risk, and department performance."
    : isFinanceManager
      ? "Review maintenance costs, approve finance requests, and monitor spending reports."
    : isSuperAdmin
      ? "Full-system control and monitoring for RECAFCO users, workflows, assets, approvals, and audit activity."
      : "Role-based maintenance workflow dashboard for your assigned responsibilities.";

  const recentLogs: AuditRow[] = await prisma.audit_logs.findMany({
    select: { id: true, action: true, summary: true, created_at: true },
    orderBy: { created_at: "desc" },
    take: 5
  }).then((rows) => rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }))).catch((): AuditRow[] => []);

  const notifications: NotificationRow[] = await prisma.notifications.findMany({
    where: {
      OR: [{ recipient_user_id: context.userId }, { recipient_id: context.userId }],
      archived_at: null
    },
    select: { id: true, title: true, message: true, notification_type: true, is_read: true, created_at: true, entity_id: true },
    orderBy: { created_at: "desc" },
    take: 8
  }).then((rows) => rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }))).catch((): NotificationRow[] => []);

  const myRecentRequests: RecentRequestRow[] = isMaintenanceDataEntry
    ? await prisma.work_orders.findMany({
        where: { created_by: context.userId },
        select: {
          id: true,
          work_order_number: true,
          maintenance_type: true,
          status: true,
          updated_at: true,
          assets: { select: { asset_name: true, asset_code: true } }
        },
        orderBy: { updated_at: "desc" },
        take: 8
      }).then((rows): RecentRequestRow[] => rows.map((row) => ({
        id: row.id,
        work_order_number: row.work_order_number,
        maintenance_type: row.maintenance_type,
        status: row.status,
        updated_at: row.updated_at.toISOString(),
        assets: row.assets
      }))).catch((): RecentRequestRow[] => [])
    : [];

  const mgrApprovalQueue: ApprovalQueueRow[] = isMaintenanceManager
    ? await prisma.work_orders
        .findMany({
          where: { ...mgrBaseWhere, status: { in: ["Submitted", "Pending Approval"] } },
          select: {
            id: true,
            work_order_number: true,
            ordered_by: true,
            priority: true,
            status: true,
            created_at: true,
            maintenance_type: true,
            assets: { select: { asset_code: true, asset_name: true } }
          },
          orderBy: { created_at: "asc" },
          take: 8
        })
        .catch((): ApprovalQueueRow[] => [])
    : [];

  return (
    <>
      <PageHeader
        title={dashboardTitle}
        description={dashboardDescription}
      />
      <div className="space-y-4 p-4 pb-28 sm:space-y-6 sm:p-6">
        {quickActions.length ? (
          <section className="lg:hidden">
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((action) => {
                const Icon = action.icon;

                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="flex min-h-16 items-center justify-between gap-3 rounded-md border border-[#DDE2EA] bg-white px-3 py-3 text-sm font-black text-[#111827] shadow-sm transition active:scale-[0.99]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-[#ED1C24]">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 leading-4">{action.label}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#64748B]" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">{mobileStatusEyebrow}</p>
              <h2 className="mt-1 text-base font-black text-[#111827]">{mobileStatusTitle}</h2>
            </div>
            {isFinanceManager ? <Landmark className="h-5 w-5 text-[#4B5563]" aria-hidden="true" /> : <ClipboardList className="h-5 w-5 text-[#4B5563]" aria-hidden="true" />}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {mobileStatusSummary.map((item) => (
              <div key={item.label} className="min-w-0 rounded-md border border-[#EEF2F6] bg-[#F8FAFC] p-3 text-center">
                <p className="text-xl font-black text-[#111827]">{item.value}</p>
                <span
                  className={[
                    "mt-2 inline-flex max-w-full items-center justify-center rounded-md border px-2 py-1 text-[11px] font-bold leading-3",
                    item.tone === "green" ? "border-green-200 bg-green-50 text-green-700" : "",
                    item.tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-700" : "",
                    item.tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "",
                    item.tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : "",
                    item.tone === "gray" ? "border-gray-200 bg-gray-50 text-gray-700" : ""
                  ].join(" ")}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4 lg:hidden">
          {mobileStats.map((stat) => (
            <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
          ))}
        </div>

        {isSuperAdmin ? (
          <>
            <section className="hidden rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm lg:block">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionTitle eyebrow="Global control" title="Super Admin Command Center" />
                <div className="flex flex-wrap gap-2">
                  {globalControlActions.map((action) => {
                    const Icon = action.icon;

                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm font-bold text-[#111827] shadow-sm transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span>{action.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="hidden space-y-4 lg:block">
              <SectionTitle eyebrow="Critical attention" title="Needs Action Now" />
              <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-5">
                {criticalStats.map((stat) => (
                  <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
                ))}
              </div>
            </section>

            <section className="hidden space-y-3 lg:block">
              <SectionTitle eyebrow="Platform status" title="System Status" />
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-6">
                <SystemStatusCard
                  label="Application"
                  value="Online"
                  detail="Server and API responding normally"
                  tone="green"
                  icon={Activity}
                />
                <SystemStatusCard
                  label="Database"
                  value={dbOnline ? "Online" : "Error"}
                  detail={dbOnline ? "PostgreSQL responding normally" : "Check database connection"}
                  tone={dbOnline ? "green" : "red"}
                  icon={Settings}
                />
                <SystemStatusCard
                  label="Backup"
                  value={backupInfo.value}
                  detail={backupInfo.detail}
                  tone={backupInfo.tone}
                  icon={Package}
                  href="/admin/system-health"
                />
                <SystemStatusCard
                  label="Active Sessions"
                  value={activeSessions}
                  detail="Non-expired authenticated sessions"
                  tone={activeSessions > 0 ? "blue" : "green"}
                  icon={Users}
                  href="/admin/system-health"
                />
                <SystemStatusCard
                  label="Failed Logins"
                  value={failedLoginsToday}
                  detail="Accounts with recent login failures"
                  tone={failedLoginsToday > 5 ? "red" : failedLoginsToday > 0 ? "amber" : "green"}
                  icon={ShieldCheck}
                  href="/admin/users"
                />
                <SystemStatusCard
                  label="Locked Accounts"
                  value={lockedAccounts}
                  detail="User accounts currently locked out"
                  tone={lockedAccounts > 0 ? "amber" : "green"}
                  icon={AlertTriangle}
                  href="/admin/users"
                />
              </div>
            </section>
          </>
        ) : null}

        {isMaintenanceDataEntry ? (
          <>
            <section className="hidden lg:block">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-[#2B2B2B] px-6 py-5 shadow-sm">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-gray-400">Daily workspace</p>
                  <h2 className="mt-1 text-xl font-black text-white">Maintenance Data Entry</h2>
                  <p className="mt-1 text-sm text-gray-300">Create and submit maintenance forms, then track your requests.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/maintenance/work-orders/new"
                    className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-[#c9151c]"
                  >
                    <PlusCircle className="h-4 w-4" aria-hidden="true" />
                    Create Request
                  </Link>
                  <Link
                    href="/maintenance/work-orders"
                    className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/20"
                  >
                    <ClipboardList className="h-4 w-4" aria-hidden="true" />
                    My Requests
                  </Link>
                  <Link
                    href="/maintenance/work-orders?status=Rejected"
                    className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/20"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Rejected / Fix
                  </Link>
                </div>
              </div>
            </section>

            <section className="hidden space-y-4 lg:block">
              <SectionTitle eyebrow="My requests" title="My Request Status" />
              <div className="grid gap-4 xl:grid-cols-6">
                {dataEntryStats.map((stat) => (
                  <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
                ))}
              </div>
            </section>

            {myRecentRequests.length > 0 && (
              <section className="hidden space-y-4 lg:block">
                <SectionTitle eyebrow="Recent activity" title="My Recent Requests" />
                <div className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-[#DDE2EA] bg-[#F8FAFC] text-left text-[11px] font-black uppercase tracking-wide text-[#4B5563]">
                          <th className="px-4 py-3">Reference No.</th>
                          <th className="px-4 py-3">Form Type</th>
                          <th className="px-4 py-3">Asset / Vehicle</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Last Updated</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEF2F6]">
                        {myRecentRequests.map((req) => {
                          const assetData = Array.isArray(req.assets) ? req.assets[0] : req.assets;
                          const isDraft = req.status === "Draft";
                          const isRejected = req.status === "Rejected";
                          const actionLabel = isRejected ? "Fix" : isDraft ? "Continue" : "View";
                          const actionHref = isDraft || isRejected
                            ? `/maintenance/work-orders/${req.id}/edit`
                            : `/maintenance/work-orders/${req.id}`;
                          return (
                            <tr key={req.id} className="transition hover:bg-[#F8FAFC]">
                              <td className="px-4 py-3 font-bold text-[#111827]">{req.work_order_number ?? "—"}</td>
                              <td className="px-4 py-3 text-[#4B5563]">Work Order</td>
                              <td className="px-4 py-3 text-[#4B5563]">
                                {assetData ? `${assetData.asset_code} – ${assetData.asset_name}` : "—"}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge label={req.status} tone={recentRequestTone(req.status)} />
                              </td>
                              <td className="px-4 py-3 text-xs text-[#4B5563]">{formatDateTime(req.updated_at)}</td>
                              <td className="px-4 py-3 text-right">
                                <Link
                                  href={actionHref}
                                  className={[
                                    "inline-block rounded-md px-3 py-1.5 text-xs font-bold transition",
                                    isRejected
                                      ? "bg-[#ED1C24] text-white hover:bg-[#c9151c]"
                                      : "border border-[#DDE2EA] text-[#111827] hover:bg-gray-50"
                                  ].join(" ")}
                                >
                                  {actionLabel}
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
          </>
        ) : null}

        {isMaintenanceManager ? (
          <>
            <section className="hidden rounded-md bg-[#111827] p-5 shadow-sm lg:block">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-gray-400">Manager workspace</p>
                  <h2 className="mt-1 text-xl font-black text-white">Maintenance Manager Workspace</h2>
                  <p className="mt-1 text-sm text-gray-300">Review approvals, control department maintenance, and monitor your work orders.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {hasPermission("work_orders.approve") && (
                    <Link
                      href="/maintenance/approvals"
                      className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-[#c9151c]"
                    >
                      <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                      Review Approvals
                      {mgrPendingApprovals > 0 && (
                        <span className="ml-0.5 rounded-full bg-white px-2 py-0.5 text-xs font-black text-[#ED1C24]">
                          {mgrPendingApprovals}
                        </span>
                      )}
                    </Link>
                  )}
                  {hasPermission("work_orders.view") && (
                    <Link
                      href="/maintenance/work-orders"
                      className="inline-flex items-center gap-2 rounded-md border border-gray-400 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      <ClipboardList className="h-4 w-4" aria-hidden="true" />
                      Work Orders
                    </Link>
                  )}
                  {hasPermission("reports.view") && (
                    <>
                      <span className="hidden h-5 w-px bg-gray-600 sm:block" aria-hidden="true" />
                      <Link
                        href="/reports/work-orders"
                        title="Reports are used for monthly summary, overdue tracking, technician workload, asset history, and Excel export."
                        className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:text-gray-200"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Reports
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </section>

            <section className="hidden space-y-4 lg:block">
              <SectionTitle eyebrow="Needs manager decision" title="Needs Manager Decision" />
              <div className="grid gap-4 xl:grid-cols-6">
                {managerDecisionStats.map((stat) => (
                  <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
                ))}
              </div>
            </section>

            {mgrApprovalQueue.length > 0 && (
              <section className="hidden space-y-4 lg:block">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <SectionTitle eyebrow="Action required" title="Pending Approval Queue" />
                  <Link href="/maintenance/approvals" className="inline-flex items-center gap-1.5 text-sm font-bold text-[#ED1C24] hover:text-[#c9151c]">
                    Review all
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                <div className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-[#DDE2EA] bg-[#F8FAFC] text-left text-[11px] font-black uppercase tracking-wide text-[#4B5563]">
                          <th className="px-4 py-3">WO / No.</th>
                          <th className="px-4 py-3">Requester</th>
                          <th className="px-4 py-3">Asset / Vehicle</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Priority</th>
                          <th className="px-4 py-3">Submitted</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEF2F6]">
                        {mgrApprovalQueue.map((wo) => {
                          const asset = wo.assets;
                          const priorityTone: DashboardTone =
                            wo.priority === "Urgent" ? "red"
                            : wo.priority === "High" ? "amber"
                            : "gray";
                          return (
                            <tr key={wo.id} className="transition hover:bg-[#F8FAFC]">
                              <td className="px-4 py-3 font-bold text-[#111827]">{wo.work_order_number ?? "—"}</td>
                              <td className="px-4 py-3 text-[#4B5563]">{wo.ordered_by ?? "—"}</td>
                              <td className="px-4 py-3 text-[#4B5563]">
                                {asset ? `${asset.asset_code} – ${asset.asset_name}` : "—"}
                              </td>
                              <td className="px-4 py-3 text-[#4B5563]">{wo.maintenance_type ?? "—"}</td>
                              <td className="px-4 py-3">
                                <StatusBadge label={wo.priority ?? "Normal"} tone={priorityTone} />
                              </td>
                              <td className="px-4 py-3 text-xs text-[#4B5563]">{daysOld(wo.created_at)}</td>
                              <td className="px-4 py-3 text-right">
                                <Link
                                  href={`/maintenance/work-orders/${wo.id}`}
                                  className="inline-block rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#c9151c]"
                                >
                                  Review
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {(mgrWaitingParts > 0 || mgrOverdue > 0 || mgrHighPriority > 0) && (
              <section className="hidden space-y-4 lg:block">
                <SectionTitle eyebrow="Blocked and overdue" title="Blocked Work" />
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {mgrWaitingParts > 0 && (
                    <Link
                      href="/maintenance/work-orders"
                      className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 shadow-sm transition hover:border-red-300"
                    >
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
                      <div>
                        <p className="text-2xl font-black text-red-600">{mgrWaitingParts}</p>
                        <p className="mt-0.5 text-sm font-bold text-red-700">Waiting for Parts / Purchase</p>
                        <p className="mt-0.5 text-xs text-red-600">Department work orders blocked by parts or purchase</p>
                      </div>
                    </Link>
                  )}
                  {mgrOverdue > 0 && (
                    <Link
                      href="/maintenance/work-orders"
                      className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 shadow-sm transition hover:border-amber-300"
                    >
                      <Bell className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                      <div>
                        <p className="text-2xl font-black text-amber-600">{mgrOverdue}</p>
                        <p className="mt-0.5 text-sm font-bold text-amber-700">Overdue Work Orders</p>
                        <p className="mt-0.5 text-xs text-amber-600">Open jobs past their planned start date</p>
                      </div>
                    </Link>
                  )}
                  {mgrHighPriority > 0 && (
                    <Link
                      href="/maintenance/work-orders"
                      className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 shadow-sm transition hover:border-amber-300"
                    >
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                      <div>
                        <p className="text-2xl font-black text-amber-600">{mgrHighPriority}</p>
                        <p className="mt-0.5 text-sm font-bold text-amber-700">Urgent / High Priority</p>
                        <p className="mt-0.5 text-xs text-amber-600">High or urgent work orders not yet closed</p>
                      </div>
                    </Link>
                  )}
                </div>
              </section>
            )}
          </>
        ) : null}

        {isCeoManagement ? (
          <CeoExecutiveDashboard
            currency={currency}
            ceoApprovalQueue={ceoApprovalQueue}
            financeQueue={financeQueue}
            blockedOperations={waitingPartsWorkOrders + waitingPurchaseWorkOrders}
            oldestBlockedDays={oldestBlockedDays}
            highRiskWork={highPriorityWorkOrders}
            overdueHighRisk={overdueHighRisk}
            maintenanceCostThisMonth={maintenanceCostThisMonth}
            pendingCeoApprovalTotal={pendingCeoApprovalTotal}
            totalPurchaseEstimatedCost={totalPurchaseEstimatedCost}
            waitingPartsWorkOrders={waitingPartsWorkOrders}
            waitingPurchaseWorkOrders={waitingPurchaseWorkOrders}
            lowStockCount={lowStockCount}
            completedThisMonth={completedThisMonth}
            decisionQueueRows={ceoDecisionQueueRows}
            deptPerformance={deptPerformance}
          />
        ) : null}

        {isFinanceManager ? (
          <>
            <section className="hidden rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm lg:block">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionTitle eyebrow="Finance control" title="Finance Approval Cockpit" />
                <div className="flex flex-wrap gap-2">
                  {financeActions.map((action) => {
                    const Icon = action.icon;

                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm font-bold text-[#111827] shadow-sm transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span>{action.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="hidden space-y-4 lg:block">
              <SectionTitle eyebrow="Pending finance decisions" title="Cost Approval Queue" />
              <div className="grid gap-4 xl:grid-cols-5">
                {financeDecisionStats.map((stat) => (
                  <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
                ))}
              </div>
            </section>
          </>
        ) : null}

        {!isCeoManagement && !isMaintenanceDataEntry ? (
        <section className="hidden space-y-4 lg:block">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle
              eyebrow={isSuperAdmin ? "Enterprise operations" : isFinanceManager ? "Cost overview" : isMaintenanceManager ? "Department scope" : "Maintenance operations"}
              title={isFinanceManager ? "Finance Cost Overview" : isMaintenanceManager ? "Department Workload Overview" : "Maintenance Workflow Overview"}
            />
            <Link href="/maintenance/work-orders" className="inline-flex items-center gap-2 text-sm font-bold text-[#ED1C24] hover:text-[#c9151c]">
              View work orders
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid gap-4 xl:grid-cols-6">
            {visibleOperationStats.map((stat) => (
              <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
            ))}
          </div>
          <div className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Status overview</p>
                <h3 className="mt-1 text-lg font-black text-[#111827]">Work Order Flow</h3>
              </div>
              <StatusBadge label={`${workOrderFlowTotal} total`} tone="blue" />
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-6">
              {workOrderFlowSummary.map((item) => (
                <div key={item.label} className="rounded-md border border-[#EEF2F6] bg-[#F8FAFC] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-[#334155]">{item.label}</p>
                    <span className={`rounded-md border px-2 py-1 text-xs font-bold ${toneClasses(item.tone)}`}>{item.value}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                    <div
                      className={[
                        "h-full rounded-full",
                        item.tone === "green" ? "bg-[#16A34A]" : "",
                        item.tone === "amber" ? "bg-[#F59E0B]" : "",
                        item.tone === "red" ? "bg-[#ED1C24]" : "",
                        item.tone === "blue" ? "bg-[#2563EB]" : "",
                        item.tone === "gray" ? "bg-[#2B2B2B]" : ""
                      ].join(" ")}
                      style={{ width: `${Math.min(100, workOrderFlowTotal ? Math.max(8, (item.value / workOrderFlowTotal) * 100) : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        ) : null}

        {isSuperAdmin ? (
          <section className="hidden space-y-4 lg:block">
            <SectionTitle eyebrow="Administration and security" title="Master Data and Security Overview" />
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {adminStats.map((stat) => (
                <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
              ))}
            </div>
          </section>
        ) : null}

        {isMaintenanceManager ? (
          <section className="hidden space-y-4 lg:block">
            <SectionTitle eyebrow="Team workflow" title="Supervisor, Technician, and Parts Queue" />
            <div className="grid gap-4 xl:grid-cols-4">
              {managerWorkflowStats.map((stat) => (
                <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
              ))}
            </div>
          </section>
        ) : null}

        {isFinanceManager ? (
          <>
            <section className="hidden space-y-4 lg:block">
              <SectionTitle eyebrow="Workflow risk" title="Cost and Purchase Risk" />
              <div className="grid gap-4 xl:grid-cols-4">
                {financeRiskStats.map((stat) => (
                  <StatCard key={stat.label} label={stat.label} mobileLabel={stat.mobileLabel} value={stat.value} detail={stat.detail} icon={stat.icon} tone={stat.tone} />
                ))}
              </div>
            </section>

            <section className="hidden rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm lg:block">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <SectionTitle eyebrow="Finance reports" title="Finance Report Access" />
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: "Finance Report", href: "/finance/reports", icon: Landmark },
                    { label: "Cost Report", href: "/reports/costs", icon: FileSpreadsheet },
                    { label: "Purchase Report", href: "/purchase/requests", icon: ShoppingCart },
                    { label: "Work Order Cost", href: "/reports/work-orders", icon: ClipboardList }
                  ].map((report) => {
                    const Icon = report.icon;

                    return (
                      <Link
                        key={report.href}
                        href={report.href}
                        className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-[#DDE2EA] bg-[#F8FAFC] px-3 py-2 text-sm font-bold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span>{report.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>
          </>
        ) : null}

        {/* ─── Cost Controller / Accounting Reviewer Dashboard ─────────────── */}
        {needsCostControllerData ? (
          <>
            <section className="hidden space-y-4 lg:block">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionTitle
                  eyebrow={isCostController ? "Cost control" : "Accounting review"}
                  title={isCostController ? "Cost Review Overview" : "Accounting Cost Overview"}
                />
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Purchase Requests", href: "/purchase/requests", icon: ShoppingCart },
                    { label: "Cost Report", href: "/reports/costs", icon: FileSpreadsheet },
                    { label: "Work Order Costs", href: "/reports/work-orders", icon: ClipboardList }
                  ].map((action) => {
                    const Icon = action.icon;
                    return (
                      <Link
                        key={action.href}
                        href={action.href}
                        className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm font-bold text-[#111827] shadow-sm transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span>{action.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Pending Cost Review"
                  mobileLabel="To Review"
                  value={ccPendingReview}
                  detail="Purchase requests in active workflow stages"
                  icon={ClipboardCheck}
                  tone={ccPendingReview > 0 ? "amber" : "green"}
                />
                <StatCard
                  label="High-Value Items (≥500 KWD)"
                  mobileLabel="High Value"
                  value={ccHighValueCount}
                  detail="Items above 500 KWD requiring cost validation"
                  icon={AlertTriangle}
                  tone={ccHighValueCount > 0 ? "red" : "green"}
                />
                <StatCard
                  label="Total Active Value (KWD)"
                  mobileLabel="Active Value"
                  value={ccTotalActiveValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  detail="Estimated value of all active purchase requests"
                  icon={FileSpreadsheet}
                  tone="blue"
                />
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-bold">Cost Controller / Accounting Review Workflow</p>
                <p className="mt-1 text-xs leading-5">
                  Cost review happens before Finance approval. Review purchase requests for cost reasonableness, budget
                  availability, and cost center allocation. Flag any duplicate or unusual items before forwarding to
                  Finance.{" "}
                  <strong>
                    Detailed cost review workflow (cost review status step) will be activated in a future release.
                  </strong>
                </p>
              </div>
            </section>
          </>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1fr_0.7fr]">
          {!isMaintenanceDataEntry && !isMaintenanceManager && !isCeoManagement && !isFinanceManager ? (
            <div className="rounded-md border border-[#DDE2EA] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Foundation status</p>
                <h2 className="mt-1 text-xl font-black text-[#111827]">System Readiness</h2>
                <p className="mt-1 text-sm leading-6 text-[#4B5563]">Phase 1 foundation status for secure maintenance operations.</p>
              </div>
              <StatusBadge label="Phase 1 active" tone="green" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                "Secure login sessions",
                "Server-side RBAC context",
                "Protected admin routes",
                "Department master data",
                "User profile management",
                "Configurable company settings"
              ].map((item) => (
                <div key={item} className="flex min-h-12 items-center gap-3 rounded-md border border-[#DDE2EA] bg-[#F8FAFC] px-3 py-2 text-sm font-semibold text-[#111827]">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          ) : null}

          <div className="rounded-md border border-[#DDE2EA] bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Session context</p>
            <h2 className="mt-1 text-xl font-black text-[#111827]">Current User</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between gap-3 border-b border-[#EEF2F6] pb-3">
                <dt className="text-[#4B5563]">Name</dt>
                <dd className="font-semibold text-[#111827]">{context.profile.full_name}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#EEF2F6] pb-3">
                <dt className="text-[#4B5563]">Role</dt>
                <dd className="font-semibold text-[#111827]">{context.role?.name ?? "Not assigned"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#EEF2F6] pb-3">
                <dt className="text-[#4B5563]">Department</dt>
                <dd className="font-semibold text-[#111827]">{context.department?.name ?? "Not assigned"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#4B5563]">Cost visibility</dt>
                <dd>{context.permissions.includes("costs.view") ? <StatusBadge label="Allowed" tone="green" /> : <StatusBadge label="Restricted" tone="amber" />}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE2EA] p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Inbox</p>
              <h2 className="mt-1 text-xl font-black text-[#111827]">In-App Notifications</h2>
              <p className="mt-1 text-sm leading-6 text-[#4B5563]">Workflow messages for approvals, assignments, completion, verification, and closure.</p>
            </div>
            <form action={markNotificationsReadAction}>
              <Button type="submit" variant="secondary">Mark read</Button>
            </form>
          </div>
          <div className="divide-y divide-[#EEF2F6]">
            {notifications?.length ? notifications.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 p-4 transition hover:bg-[#F8FAFC] sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-[#111827]">{item.title}</p>
                  <p className="text-sm text-[#4B5563]">{item.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!item.is_read ? <StatusBadge label="New" tone="red" /> : <StatusBadge label="Read" tone="gray" />}
                  <p className="text-xs text-[#4B5563]">{formatDateTime(item.created_at)}</p>
                </div>
              </div>
            )) : <p className="p-5 text-sm text-[#4B5563]">No notifications.</p>}
          </div>
        </section>

        {isSuperAdmin ? (
        <section className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
          <div className="border-b border-[#DDE2EA] p-6">
            <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Activity trail</p>
            <h2 className="mt-1 text-xl font-black text-[#111827]">Recent Audit Activity</h2>
          </div>
          <div className="divide-y divide-[#EEF2F6]">
            {recentLogs?.length ? (
              recentLogs.map((log) => (
                <div key={log.id} className="flex flex-col gap-1 p-4 transition hover:bg-[#F8FAFC] sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-[#111827]">{log.summary}</p>
                    <p className="text-sm text-[#4B5563]">{log.action}</p>
                  </div>
                  <p className="text-sm text-[#4B5563]">{formatDateTime(log.created_at)}</p>
                </div>
              ))
            ) : (
              <p className="p-5 text-sm text-[#4B5563]">No audit activity recorded yet.</p>
            )}
          </div>
        </section>
        ) : null}
      </div>
    </>
  );
}
