import { FormDocumentHeader } from "@/components/forms/form-document-header";
import { writeAuditLog } from "@/lib/audit/log";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";

export default async function PrintPartsRequestPage({ params }: { params: Promise<{ id: string }> }) {
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
  if (!request) return <div className="p-8">Parts request not found.</div>;
  const items = rawItems.map((item) => ({
    ...item,
    quantity_requested: item.quantity_requested.toFixed(2),
    unit_price: item.unit_price.toFixed(3),
    total_price: item.total_price?.toFixed(3) ?? null,
    issued_quantity: item.issued_quantity.toFixed(2)
  }));
  await writeAuditLog({
    actorId: context.userId,
    action: "parts_request.print",
    entityType: "parts_request",
    entityId: id,
    summary: `Opened print view for parts request ${request.parts_request_number}`
  });
  const workOrder = Array.isArray(request.work_orders) ? request.work_orders[0] : request.work_orders;
  const asset = Array.isArray(request.assets) ? request.assets[0] : request.assets;
  const department = Array.isArray(request.departments) ? request.departments[0] : request.departments;

  return (
    <div className="bg-white p-6 text-[#111827] print:p-0">
      <style>{`@media print { aside, .lg\\:pl-72 > header { display: none !important; } .print-hide { display:none!important; } }`}</style>
      <button className="print-hide mb-4 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white">Use browser print or Ctrl+P</button>
      <article className="mx-auto max-w-5xl border border-[#E5E7EB] p-8 shadow-sm">
        <FormDocumentHeader
          variant="print"
          title="Parts Request"
          departmentName="Maintenance Department"
          subtitle={`Generated: ${formatDateTime(new Date().toISOString())}`}
          referenceLabel="Number"
          referenceNumber={request.parts_request_number}
          status={request.status}
        />
        <Grid rows={[
          ["Department", department?.name],
          ["Work order", workOrder?.work_order_number],
          ["Asset", asset ? `${asset.asset_code} - ${asset.asset_name}` : ""],
          ["Date", request.request_date],
          ["Time", request.request_time.toISOString().slice(11, 19)],
          ["Serial number", request.serial_number],
          ["Remarks", request.remarks],
          ["Total", request.total_price.toFixed(3)]
        ]} />
        <Table title="Requested Items" rows={items ?? []} columns={["description", "part_number", "ss_rec_code", "quantity_requested", "unit_price", "total_price", "stock_availability", "issued_quantity", "remarks"]} />
        <Grid rows={[
          ["Approval comments", request.approval_comments],
          ["Store comments", request.store_issue_comments],
          ["Generated", formatDateTime(new Date().toISOString())],
          ["Internal route", `/store/parts-requests/${request.id}`]
        ]} />
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
