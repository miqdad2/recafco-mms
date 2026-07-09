import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  ClipboardList,
  Gauge,
  Package,
  ShieldAlert,
  Wrench
} from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { getReportLandingStats } from "@/lib/reports/data";

export default async function ReportsLandingPage() {
  await requirePermission("reports.view");

  const stats = await getReportLandingStats().catch(() => ({
    openWOs: 0,
    overdueWOs: 0,
    criticalAssets: 0,
    lowStockCount: 0
  }));

  return (
    <>
      <PageHeader
        title="Maintenance Reports"
        description="View repair orders, asset history, spare parts usage, and maintenance performance."
      />

      <div className="p-4 lg:p-6 space-y-6">

        {/* Quick stats strip */}
        {(stats.openWOs > 0 || stats.overdueWOs > 0 || stats.criticalAssets > 0 || stats.lowStockCount > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center">
              <p className="text-2xl font-black text-[#111827]">{stats.openWOs}</p>
              <p className="mt-1 text-xs font-semibold text-[#4B5563]">Open Repair Orders</p>
            </div>
            <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center">
              <p className={`text-2xl font-black ${stats.overdueWOs > 0 ? "text-[#DC2626]" : "text-[#111827]"}`}>{stats.overdueWOs}</p>
              <p className="mt-1 text-xs font-semibold text-[#4B5563]">Overdue</p>
            </div>
            <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center">
              <p className={`text-2xl font-black ${stats.criticalAssets > 0 ? "text-amber-600" : "text-[#111827]"}`}>{stats.criticalAssets}</p>
              <p className="mt-1 text-xs font-semibold text-[#4B5563]">Critical / Breakdown Assets</p>
            </div>
            <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center">
              <p className={`text-2xl font-black ${stats.lowStockCount > 0 ? "text-amber-600" : "text-[#111827]"}`}>{stats.lowStockCount}</p>
              <p className="mt-1 text-xs font-semibold text-[#4B5563]">Low / Out of Stock Parts</p>
            </div>
          </div>
        )}

        {/* Report cards grid */}
        <div>
          <p className="mb-3 text-xs font-black uppercase tracking-widest text-[#4B5563]">Available Reports</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">

            <ReportCard
              href="/reports/work-orders"
              icon={ClipboardList}
              title="Repair Order Summary"
              description="Track open, in-progress, waiting parts, completed, closed, and overdue repair orders."
              badge={stats.overdueWOs > 0 ? `${stats.overdueWOs} overdue` : undefined}
              badgeTone="red"
            />

            <ReportCard
              href="/reports/asset-history"
              icon={Wrench}
              title="Asset Repair History"
              description="View complete repair history by asset or machine."
            />

            <ReportCard
              href="/reports/assets"
              icon={ShieldAlert}
              title="Critical Asset Report"
              description="Monitor critical, poor condition, breakdown, and repeated-issue assets."
              badge={stats.criticalAssets > 0 ? `${stats.criticalAssets} need attention` : undefined}
              badgeTone="amber"
            />

            <ReportCard
              href="/reports/spare-parts-usage"
              icon={Package}
              title="Spare Parts Usage"
              description="Track parts used across repair orders and assets."
            />

            <ReportCard
              href="/reports/low-stock"
              icon={AlertTriangle}
              title="Low Stock Spare Parts"
              description="Review parts below minimum stock and unavailable items."
              badge={stats.lowStockCount > 0 ? `${stats.lowStockCount} below minimum` : undefined}
              badgeTone="amber"
            />

            <ReportCard
              href="/reports/work-orders?report=technician-workload"
              icon={BarChart3}
              title="Technician Workload"
              description="Monitor assigned, in-progress, and completed jobs by technician."
              comingSoon={false}
            />

            <ReportCard
              href="/reports/preventive-maintenance"
              icon={Calendar}
              title="Preventive Maintenance"
              description="Track due, overdue, and upcoming preventive maintenance by asset."
            />

            <ReportCard
              href="/reports/assets?view=register"
              icon={Gauge}
              title="Asset Register Report"
              description="Full asset list with status, expiry dates, service due, and inspection data."
            />

          </div>
        </div>
      </div>
    </>
  );
}

function ReportCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  badgeTone = "amber",
  comingSoon
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: string;
  badgeTone?: "red" | "amber";
  comingSoon?: boolean;
}) {
  const badgeClass =
    badgeTone === "red"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";

  return (
    <Link
      href={comingSoon ? "#" : href}
      className={`group relative flex flex-col gap-3 rounded-lg border bg-white p-5 shadow-sm transition-all ${
        comingSoon
          ? "border-[#E5E7EB] cursor-default opacity-70"
          : "border-[#E5E7EB] hover:border-[#ED1C24] hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${comingSoon ? "bg-gray-100" : "bg-red-50"}`}>
          <Icon className={`h-5 w-5 ${comingSoon ? "text-[#9CA3AF]" : "text-[#ED1C24]"}`} aria-hidden="true" />
        </div>
        <div className="flex gap-1.5">
          {badge && !comingSoon && (
            <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>
              {badge}
            </span>
          )}
          {comingSoon && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-[#4B5563]">
              Coming soon
            </span>
          )}
        </div>
      </div>
      <div>
        <p className="font-bold text-[#111827]">{title}</p>
        <p className="mt-1 text-sm text-[#4B5563] leading-snug">{description}</p>
      </div>
      {!comingSoon && (
        <p className="mt-auto text-xs font-semibold text-[#ED1C24] opacity-0 transition-opacity group-hover:opacity-100">
          View report →
        </p>
      )}
    </Link>
  );
}
