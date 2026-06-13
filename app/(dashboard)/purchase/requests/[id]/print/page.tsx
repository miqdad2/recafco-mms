import { FormDocumentHeader } from "@/components/forms/form-document-header";
import { writeAuditLog } from "@/lib/audit/log";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";

export default async function PrintPurchaseRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("purchase_requests.view");
  const { id } = await params;
  const [purchase, rawItems] = await Promise.all([
    prisma.purchase_requests.findUnique({
      where: { id },
      include: {
        work_orders: { select: { work_order_number: true } },
        parts_requests: { select: { parts_request_number: true } }
      }
    }),
    prisma.purchase_request_items.findMany({
      where: { purchase_request_id: id }
    })
  ]);
  if (!purchase) return <div className="p-8">Purchase request not found.</div>;
  const items = rawItems.map((item) => ({
    ...item,
    quantity: item.quantity.toFixed(2),
    estimated_unit_price: item.estimated_unit_price.toFixed(3),
    estimated_total: item.estimated_total?.toFixed(3) ?? null
  }));
  await writeAuditLog({
    actorId: context.userId,
    action: "purchase_request.print",
    entityType: "purchase_request",
    entityId: id,
    summary: `Opened print view for purchase request ${purchase.purchase_request_number}`
  });
  const workOrder = Array.isArray(purchase.work_orders) ? purchase.work_orders[0] : purchase.work_orders;
  const partsRequest = Array.isArray(purchase.parts_requests) ? purchase.parts_requests[0] : purchase.parts_requests;

  return (
    <div className="bg-white p-6 text-[#111827] print:p-0">
      <style>{`@media print { aside, .lg\\:pl-72 > header { display: none !important; } .print-hide { display:none!important; } }`}</style>
      <button className="print-hide mb-4 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white">Use browser print or Ctrl+P</button>
      <article className="mx-auto max-w-5xl border border-[#E5E7EB] p-8 shadow-sm">
        <FormDocumentHeader
          variant="print"
          title="Purchase Request"
          departmentName="Purchase Department"
          subtitle={`Generated: ${formatDateTime(new Date().toISOString())}`}
          referenceLabel="Number"
          referenceNumber={purchase.purchase_request_number}
          status={purchase.status}
        />
        <Grid rows={[
          ["Work order", workOrder?.work_order_number],
          ["Parts request", partsRequest?.parts_request_number],
          ["Supplier", purchase.supplier],
          ["Estimated total", purchase.estimated_total.toFixed(3)],
          ["Finance comments", purchase.finance_comments],
          ["CEO comments", purchase.ceo_comments],
          ["Quotation", purchase.quotation_file_name],
          ["Invoice", purchase.invoice_file_name],
          ["Delivery note", purchase.delivery_note_file_name],
          ["Internal route", `/purchase/requests/${purchase.id}`]
        ]} />
        <Table title="Purchase Items" rows={items ?? []} columns={["description", "quantity", "estimated_unit_price", "estimated_total", "supplier"]} />
        <section className="mt-8 grid grid-cols-3 gap-4">
          {["Purchase Officer", "Finance Manager", "CEO / Management"].map((label) => <div key={label} className="min-h-24 border border-[#E5E7EB] p-3"><p className="text-xs font-bold uppercase text-[#4B5563]">{label}</p><p className="mt-10 border-t pt-2 text-sm">Signature / Date</p></div>)}
        </section>
      </article>
    </div>
  );
}

function Grid({ rows }: { rows: Array<[string, unknown]> }) {
  return <section className="mt-6 grid grid-cols-3 border border-[#E5E7EB] text-sm">{rows.map(([label, value]) => <div key={label} className="border-b border-r border-[#E5E7EB] p-2"><p className="text-xs font-bold uppercase text-[#4B5563]">{label}</p><p className="mt-1 font-semibold">{String(value ?? "Not recorded")}</p></div>)}</section>;
}

function Table({ title, rows, columns }: { title: string; rows: Array<Record<string, unknown>>; columns: string[] }) {
  return <section className="mt-6"><h2 className="border-b border-[#E5E7EB] pb-2 text-lg font-black">{title}</h2><table className="mt-3 w-full border-collapse text-left text-sm"><thead><tr>{columns.map((column) => <th key={column} className="border border-[#E5E7EB] bg-gray-50 p-2">{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={String(row.id)}>{columns.map((column) => <td key={column} className="border border-[#E5E7EB] p-2">{String(row[column] ?? "-")}</td>)}</tr>) : <tr><td className="border border-[#E5E7EB] p-2" colSpan={columns.length}>No records.</td></tr>}</tbody></table></section>;
}
