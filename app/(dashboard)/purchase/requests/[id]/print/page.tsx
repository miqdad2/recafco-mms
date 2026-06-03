import Image from "next/image";

import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function PrintPurchaseRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("purchase_requests.view");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: purchase }, { data: items }] = await Promise.all([
    supabase.from("purchase_requests").select("*, work_orders(work_order_number), parts_requests(parts_request_number)").eq("id", id).single(),
    supabase.from("purchase_request_items").select("*").eq("purchase_request_id", id)
  ]);
  if (!purchase) return <div className="p-8">Purchase request not found.</div>;
  const workOrder = Array.isArray(purchase.work_orders) ? purchase.work_orders[0] : purchase.work_orders;
  const partsRequest = Array.isArray(purchase.parts_requests) ? purchase.parts_requests[0] : purchase.parts_requests;

  return (
    <div className="bg-white p-6 text-[#111827] print:p-0">
      <style>{`@media print { aside, .lg\\:pl-72 > header { display: none !important; } .print-hide { display:none!important; } }`}</style>
      <button className="print-hide mb-4 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white">Use browser print or Ctrl+P</button>
      <article className="mx-auto max-w-5xl border border-[#E5E7EB] p-8 shadow-sm">
        <div className="flex items-start justify-between border-b-4 border-[#ED1C24] pb-5">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-24 rounded-md border border-[#E5E7EB] bg-white"><Image src="/recafco-logo.png" alt="RECAFCO logo" fill className="object-contain p-1" /></div>
            <div><h1 className="text-2xl font-black">RECAFCO Purchase Request</h1><p className="text-sm text-[#4B5563]">Generated: {formatDateTime(new Date().toISOString())}</p></div>
          </div>
          <div className="text-right"><p className="text-sm text-[#4B5563]">Number</p><p className="text-xl font-black text-[#ED1C24]">{purchase.purchase_request_number}</p><p className="mt-2 text-sm font-bold">{purchase.status}</p></div>
        </div>
        <Grid rows={[
          ["Work order", workOrder?.work_order_number],
          ["Parts request", partsRequest?.parts_request_number],
          ["Supplier", purchase.supplier],
          ["Estimated total", purchase.estimated_total],
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
