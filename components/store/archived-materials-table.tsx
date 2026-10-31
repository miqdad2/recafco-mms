"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArchiveRestore, Loader2 } from "lucide-react";

import { restoreArchivedMaterialAction } from "@/app/actions/material-master";
import { fmtDate } from "@/components/store/offline-inventory-types";

export type ArchivedMaterialTableRow = {
  key: string;
  display_name: string;
  item_code: string | null;
  unit: string;
  category: string;
  total_received: number;
  total_issued: number;
  last_movement_date: string;
  archived_at: string | null;
  archived_by_name: string;
  archive_reason: string | null;
};

function qty(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function ArchivedMaterialsTable({ rows }: { rows: ArchivedMaterialTableRow[] }) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  function restore(row: ArchivedMaterialTableRow) {
    if (pendingKey) return;
    if (!window.confirm(`Restore “${row.display_name}” to Inventory Control? It will be available for new material requests again.`)) return;
    setPendingKey(row.key);
    setMessage(null);
    startTransition(async () => {
      const r = await restoreArchivedMaterialAction(row.key);
      setPendingKey(null);
      setMessage(r.ok ? { ok: true, text: `${r.data.display_name} restored to Inventory Control.` } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      {message && (
        <p
          role="status"
          className={`border-b px-4 py-2 text-sm font-semibold ${message.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-[#B91C1C]"}`}
        >
          {message.text}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-[#6B7280]">No archived materials.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F3F4F6] text-left text-[11px] font-bold uppercase tracking-wide text-[#4B5563]">
              <tr>
                <th className="px-2.5 py-2">Material</th>
                <th className="px-2.5 py-2">Item Code</th>
                <th className="px-2.5 py-2">Unit</th>
                <th className="px-2.5 py-2">Category</th>
                <th className="whitespace-nowrap px-2.5 py-2 text-right">Total Received</th>
                <th className="whitespace-nowrap px-2.5 py-2 text-right">Total Issued</th>
                <th className="whitespace-nowrap px-2.5 py-2">Last Movement</th>
                <th className="px-2.5 py-2">Archived</th>
                <th className="px-2.5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="min-w-[140px] px-2.5 py-1.5 font-semibold text-[#111827]">{r.display_name}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-xs">{r.item_code ?? "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-xs">{r.unit}</td>
                  <td className="px-2.5 py-1.5 text-xs">{r.category}</td>
                  <td className="px-2.5 py-1.5 text-right">{qty(r.total_received)}</td>
                  <td className="px-2.5 py-1.5 text-right">{qty(r.total_issued)}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-xs">{fmtDate(r.last_movement_date)}</td>
                  <td className="min-w-[160px] px-2.5 py-1.5 text-xs text-[#4B5563]">
                    {r.archived_at ? fmtDate(r.archived_at) : "—"} · {r.archived_by_name}
                    {r.archive_reason && <span className="block text-[#6B7280]">{r.archive_reason}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <Link
                        href={`/store/offline-inventory/movements?q=${encodeURIComponent(r.display_name)}`}
                        className="inline-flex min-h-[36px] items-center rounded-md border border-[#E5E7EB] px-2.5 text-xs font-bold text-[#111827] hover:bg-gray-50"
                      >
                        History
                      </Link>
                      <button
                        type="button"
                        onClick={() => restore(r)}
                        disabled={pendingKey !== null}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-md bg-[#111827] px-2.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
                      >
                        {pendingKey === r.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />}
                        Restore
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
