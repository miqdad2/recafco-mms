import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, MonitorPlay } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";

const demoSteps = [
  { title: "System Map", href: "/admin/system-map", description: "Start with the management workflow map to show the full maintenance lifecycle and completed phases." },
  { title: "Dashboard", href: "/dashboard", description: "Show operational KPIs, pending work, cost visibility, and management monitoring." },
  { title: "Assets", href: "/assets", description: "Open an asset to show master data, expiry alerts, service information, documents, history, and QR code." },
  { title: "Work Orders", href: "/maintenance/work-orders", description: "Review the digital work order register, statuses, paper-form fields, attachments, print layout, and QR code." },
  { title: "Approval", href: "/maintenance/approvals", description: "Show manager review for submitted work orders with approval and rejection comments." },
  { title: "Technician Job", href: "/technician/jobs", description: "Switch to the mobile-focused technician flow for assigned jobs, notes, labor, parts, and completion." },
  { title: "Parts Request", href: "/store/parts-requests", description: "Show linked spare-part requests, item rows, approval status, and total price summary." },
  { title: "Store Issue", href: "/store/parts-requests", description: "Demonstrate full issue, partial issue, unavailable marking, and inventory movement creation." },
  { title: "Purchase", href: "/purchase/requests", description: "Show unavailable-part purchase requests, supplier details, order status, and receiving foundation." },
  { title: "Finance", href: "/finance/approvals", description: "Show finance approval, cost governance, and CEO threshold visibility for high-value requests." },
  { title: "Reports", href: "/reports/work-orders", description: "Finish with reports and native Excel exports for work orders, assets, inventory, costs, and preventive maintenance." }
];

export default async function DemoGuidePage() {
  const context = await requireUser();
  if (context.role?.slug !== "super_admin") {
    redirect("/dashboard?error=super-admin-required");
  }

  return (
    <>
      <PageHeader
        title="Management Demo Guide"
        description="Super Admin presentation script for showing the finished RECAFCO Maintenance Management System to IT Manager and management."
      />
      <div className="space-y-5 p-4 lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-red-50 text-[#ED1C24]">
                <MonitorPlay className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-black text-[#111827]">Recommended flow</h2>
                <p className="mt-1 max-w-3xl text-sm text-[#4B5563]">
                  Use this order to tell a clear story: management visibility first, then asset and work-order execution, then store, purchase, finance, and reporting.
                </p>
              </div>
            </div>
            <StatusBadge label="Super Admin only" tone="red" />
          </div>
        </section>

        <ol className="grid gap-4 xl:grid-cols-2">
          {demoSteps.map((step, index) => (
            <li key={step.title} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#111827] text-sm font-black text-white">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-base font-black text-[#111827]">{step.title}</h2>
                    <Link href={step.href} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#E5E7EB] px-3 text-sm font-bold text-[#ED1C24] hover:bg-gray-50">
                      Open
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#4B5563]">{step.description}</p>
                  <p className="mt-3 break-all text-xs font-bold uppercase text-[#4B5563]">{step.href}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
