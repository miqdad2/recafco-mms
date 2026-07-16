import Link from "next/link";
import {
  ArrowDownUp,
  BarChart3,
  ClipboardList,
  FileText,
  Gauge,
  Package,
  ShoppingCart,
  Wrench,
} from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { getReportLandingStats } from "@/lib/reports/data";

export default async function ReportsLandingPage() {
  await requirePermission("reports.view");

  const stats = await getReportLandingStats().catch(() => ({
    openWOs: 0,
    overdueWOs: 0,
    openPartsRequests: 0,
    expiringContracts: 0,
  }));

  return (
    <>
      <PageHeader
        title="Maintenance Reports"
        description="View job cards, asset history, materials usage, and maintenance performance."
      />

      <div className="p-4 lg:p-6 space-y-6">

        {/* Summary strip — always shown */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            value={stats.openWOs}
            label="Open Job Cards"
            href="/reports/work-orders"
            tone={stats.openWOs > 0 ? "amber" : "green"}
          />
          <StatCard
            value={stats.overdueWOs}
            label="Overdue Job Cards"
            href="/reports/work-orders"
            tone={stats.overdueWOs > 0 ? "red" : "green"}
          />
          <StatCard
            value={stats.openPartsRequests}
            label="Open Materials Requests"
            href="/store/parts-requests"
            tone={stats.openPartsRequests > 0 ? "amber" : "green"}
          />
          <StatCard
            value={stats.expiringContracts}
            label="Contracts Expiring (30d)"
            href="/assets/service-contracts"
            tone={stats.expiringContracts > 0 ? "amber" : "green"}
          />
        </div>

        {/* Report cards grid */}
        <div>
          <p className="mb-3 text-xs font-black uppercase tracking-widest text-[#4B5563]">Available Reports</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">

            <ReportCard
              href="/reports/work-orders"
              icon={ClipboardList}
              title="Job Card Summary"
              description="Track open, in-progress, waiting materials, completed, closed, and overdue job cards."
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
              href="/reports/spare-parts-usage"
              icon={Package}
              title="Materials Usage"
              description="Track materials used across job cards and assets."
            />

            <ReportCard
              href="/reports/work-orders?report=technician-workload"
              icon={BarChart3}
              title="Technician Workload"
              description="Monitor assigned, in-progress, and completed jobs by technician."
            />

            <ReportCard
              href="/reports/assets?view=register"
              icon={Gauge}
              title="Asset Register Report"
              description="Full asset list with status, expiry dates, service due, and inspection data."
            />

            <ReportCard
              href="/store/parts-requests"
              icon={ShoppingCart}
              title="Materials Requests"
              description="View and track all materials requests by status, job card, and date."
              badge={stats.openPartsRequests > 0 ? `${stats.openPartsRequests} open` : undefined}
              badgeTone="amber"
            />

            <ReportCard
              href="/store/offline-inventory"
              icon={ArrowDownUp}
              title="Offline Inventory Control Report"
              description="Maintenance Store balance by category, movement history, and materials usage for opening stock, receipts, and issues."
            />

            <ReportCard
              href="/assets/service-contracts"
              icon={FileText}
              title="Service Contracts Expiry"
              description="Monitor service contract end dates, renewals, and upcoming expirations."
              badge={stats.expiringContracts > 0 ? `${stats.expiringContracts} expiring soon` : undefined}
              badgeTone="amber"
            />

          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  value,
  label,
  href,
  tone,
}: {
  value: number;
  label: string;
  href: string;
  tone: "red" | "amber" | "green";
}) {
  const valueClass =
    tone === "red"
      ? "text-[#DC2626]"
      : tone === "amber"
        ? "text-amber-600"
        : "text-[#111827]";
  return (
    <Link
      href={href}
      className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center transition hover:border-[#ED1C24] hover:shadow-md block"
    >
      <p className={`text-2xl font-black ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs font-semibold text-[#4B5563]">{label}</p>
    </Link>
  );
}

function ReportCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  badgeTone = "amber",
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  badge?: string;
  badgeTone?: "red" | "amber";
}) {
  const badgeClass =
    badgeTone === "red"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";

  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-3 rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm transition-all hover:border-[#ED1C24] hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50">
          <Icon className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" />
        </div>
        {badge && (
          <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <p className="font-bold text-[#111827]">{title}</p>
        <p className="mt-1 text-sm text-[#4B5563] leading-snug">{description}</p>
      </div>
      <p className="mt-auto text-xs font-semibold text-[#ED1C24] opacity-0 transition-opacity group-hover:opacity-100">
        View report →
      </p>
    </Link>
  );
}
