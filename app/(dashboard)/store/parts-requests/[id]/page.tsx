import { approvePartsRequestAction, rejectPartsRequestAction } from "@/app/actions/phase4";
import { PartsRequestItemsTable } from "@/components/store/parts-request-items-table";
import { StoreIssuePanel } from "@/components/store/store-issue-panel";
import { Button } from "@/components/ui/button";
import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import Link from "next/link";

export default async function PartsRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("parts_requests.view");
  const { id } = await params;
  const [request, rawItems] = await Promise.all([
    prisma.parts_requests.findUnique({
      where: { id },
      include: {
        work_orders: { select: { work_order_number: true } },
        assets: { select: { asset_code: true, asset_name: true } },
        departments: { select: { name: true } }
      }
    }),
    prisma.parts_request_items.findMany({
      where: { parts_request_id: id }
    })
  ]);
  if (!request) return <PageHeader title="Parts request not found" />;
  const items = rawItems.map((item) => ({
    ...item,
    quantity_requested: item.quantity_requested.toFixed(2),
    unit_price: item.unit_price.toFixed(3),
    total_price: item.total_price?.toFixed(3) ?? null,
    issued_quantity: item.issued_quantity.toFixed(2)
  }));
  const canApprove = context.role?.slug === "super_admin" || context.permissions.includes("parts_requests.approve");
  return (
    <>
      <PageHeader title={request.parts_request_number ?? ""} description="Parts request detail, approval, store issue, unavailable items, and purchase creation." actions={<><Link href={`/store/parts-requests/${request.id}/print`}><Button variant="secondary">Print</Button></Link><StatusBadge label={request.status} tone="blue" /></>} />
      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_0.8fr] lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Request Summary</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Info label="Work order" value={(Array.isArray(request.work_orders) ? request.work_orders[0]?.work_order_number : request.work_orders?.work_order_number) ?? "-"} />
            <Info label="Asset" value={(Array.isArray(request.assets) ? request.assets[0]?.asset_code : request.assets?.asset_code) ?? "-"} />
            <Info label="Department" value={(Array.isArray(request.departments) ? request.departments[0]?.name : request.departments?.name) ?? "-"} />
            <Info label="Total" value={<CostVisibilityGuard context={context}>{request.total_price.toFixed(3)}</CostVisibilityGuard>} />
          </dl>
        </section>
        <section className="space-y-5">
          {canApprove && ["Submitted", "Pending Approval"].includes(request.status) ? (
            <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Maintenance Manager Approval</h2>
              <div className="mt-4 grid gap-3">
                <form action={approvePartsRequestAction} className="space-y-2"><input type="hidden" name="parts_request_id" value={id} /><textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="comments" placeholder="Approval comments" /><Button type="submit" className="w-full">Approve</Button></form>
                <form action={rejectPartsRequestAction} className="space-y-2"><input type="hidden" name="parts_request_id" value={id} /><textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="comments" placeholder="Rejection reason" required /><Button type="submit" variant="danger" className="w-full">Reject</Button></form>
              </div>
            </section>
          ) : null}
          <StoreIssuePanel requestId={id} status={request.status} items={items ?? []} context={context} />
        </section>
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold">Items</h2>
          <PartsRequestItemsTable items={items ?? []} context={context} />
        </section>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-sm text-[#4B5563]">{label}</dt><dd className="font-bold text-[#111827]">{value}</dd></div>;
}
