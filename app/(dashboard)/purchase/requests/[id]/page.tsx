import { uploadPurchaseFileAction } from "@/app/actions/files";
import { PrivateFilePanel } from "@/components/files/private-file-panel";
import { SignedFileList } from "@/components/files/signed-file-list";
import { CEOApprovalPanel, FinanceApprovalPanel } from "@/components/finance/approval-panels";
import { PurchaseWorkflowPanel } from "@/components/purchase/purchase-workflow-panel";
import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { createSignedFileUrl } from "@/lib/files/signed-url";
import { canViewEntityFile } from "@/lib/security/file-access";
import Link from "next/link";

export default async function PurchaseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("purchase_requests.view");
  const { id } = await params;
  const [purchase, rawItems] = await Promise.all([
    prisma.purchase_requests.findUnique({ where: { id } }),
    prisma.purchase_request_items.findMany({
      include: { parts: { select: { part_code: true, part_name: true } } },
      where: { purchase_request_id: id }
    })
  ]);
  if (!purchase) return <PageHeader title="Purchase request not found" />;
  const items = rawItems.map((item) => ({
    ...item,
    quantity: item.quantity.toFixed(2),
    estimated_unit_price: item.estimated_unit_price.toFixed(3),
    estimated_total: item.estimated_total?.toFixed(3) ?? null
  }));
  const canUploadFiles = context.role?.slug === "super_admin" || (context.permissions.includes("purchase_requests.manage") && context.permissions.includes("files.upload"));
  const signedFiles = await Promise.all([
    { id: "quotation", label: "Quotation", fileName: purchase.quotation_file_name, filePath: purchase.quotation_file_path },
    { id: "invoice", label: "Invoice", fileName: purchase.invoice_file_name, filePath: purchase.invoice_file_path },
    { id: "delivery", label: "Delivery Note", fileName: purchase.delivery_note_file_name, filePath: purchase.delivery_note_file_path }
  ].filter((file) => file.fileName && file.filePath).map(async (file) => ({
    id: file.id,
    label: file.label,
    fileName: file.fileName as string,
    signedUrl: await canViewEntityFile(context, "purchase-files", purchase.id) ? await createSignedFileUrl("purchase-files", file.filePath) : null
  })));
  return (
    <>
      <PageHeader title={purchase.purchase_request_number ?? ""} description="Purchase request details, supplier metadata, finance approval, CEO threshold approval, and receiving." actions={<><Link href={`/purchase/requests/${purchase.id}/print`}><Button variant="secondary">Print</Button></Link><StatusBadge label={purchase.status} tone="blue" /></>} />
      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_0.85fr] lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Purchase Summary</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Info label="Supplier" value={purchase.supplier ?? "Not recorded"} />
            <Info label="Estimate" value={<CostVisibilityGuard context={context}>{purchase.estimated_total.toFixed(3)}</CostVisibilityGuard>} />
            <Info label="Quotation" value={purchase.quotation_file_name ?? "Not recorded"} />
            <Info label="Notes" value={purchase.purchase_officer_notes ?? "Not recorded"} />
          </dl>
        </section>
        <section className="space-y-5">
          <FinanceApprovalPanel purchase={purchase} context={context} />
          <CEOApprovalPanel purchase={purchase} context={context} />
          <PurchaseWorkflowPanel purchase={purchase} context={context} />
        </section>
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold">Items</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2">Total</th></tr></thead><tbody>{items?.map((item) => <tr key={item.id} className="border-t"><td className="px-3 py-2">{item.description}</td><td className="px-3 py-2">{item.quantity}</td><td className="px-3 py-2"><CostVisibilityGuard context={context}>{item.estimated_unit_price}</CostVisibilityGuard></td><td className="px-3 py-2"><CostVisibilityGuard context={context}>{item.estimated_total}</CostVisibilityGuard></td></tr>)}</tbody></table></div>
        </section>
        <section className="grid gap-5 lg:col-span-2 lg:grid-cols-[1fr_0.9fr]">
          <SignedFileList title="Private Purchase Files" files={signedFiles} />
          {canUploadFiles ? (
            <PrivateFilePanel
              title="Upload Purchase File"
              description="Add quotation, invoice, or delivery note files with signed URL viewing."
              action={uploadPurchaseFileAction}
              hiddenFields={{ purchase_request_id: purchase.id }}
              typeFieldName="file_type"
              typeOptions={["quotation", "invoice", "delivery_note"]}
            />
          ) : null}
        </section>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-sm text-[#4B5563]">{label}</dt><dd className="font-bold text-[#111827]">{value}</dd></div>;
}
