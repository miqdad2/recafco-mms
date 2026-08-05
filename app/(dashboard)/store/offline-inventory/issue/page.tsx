import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { IssueMaterialForm } from "@/components/store/issue-material-form";
import { prisma } from "@/lib/db/prisma";
import {
  getOfflineInventoryBalance,
  getWorkOrderOptions,
  requireOfflineInventoryManage,
} from "@/lib/store/offline-inventory-data";

export default async function IssueMaterialPage({
  searchParams,
}: {
  searchParams?: Promise<{ workOrder?: string }>;
}) {
  await requireOfflineInventoryManage();

  const sp = (await searchParams) ?? {};
  const issueWorkOrderId = sp.workOrder || null;

  const [{ balanceItems }, workOrdersRaw, presetWorkOrder] = await Promise.all([
    getOfflineInventoryBalance(),
    getWorkOrderOptions(),
    issueWorkOrderId
      ? prisma.work_orders.findUnique({ where: { id: issueWorkOrderId }, select: { id: true, work_order_number: true } })
      : Promise.resolve(null),
  ]);
  const workOrders =
    presetWorkOrder && !workOrdersRaw.some((wo) => wo.id === presetWorkOrder.id)
      ? [presetWorkOrder, ...workOrdersRaw]
      : workOrdersRaw;
  const availableItems = balanceItems.filter((b) => b.balance > 0);

  return (
    <>
      <PageHeader
        title="Issue Material"
        description="Issue materials for a Job Card or maintenance work."
        actions={
          <Link
            href="/store/offline-inventory"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Offline Inventory Control
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        <IssueMaterialForm availableItems={availableItems} workOrders={workOrders} />
      </div>
    </>
  );
}
