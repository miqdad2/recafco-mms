"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  getMaterialRecentMovementsAction,
  type MaterialMovementRow,
} from "@/app/actions/offline-inventory";
import {
  fmtDate,
  movementTypeLabel,
  movementTypeTone,
  type BalanceItem,
} from "@/components/store/offline-inventory-types";

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3 text-center">
      <p className={`text-lg font-black ${highlight ? "text-[#ED1C24]" : "text-[#111827]"}`}>
        {value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
      </p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-[#4B5563]">{label}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#111827]">{value}</p>
    </div>
  );
}

export function MaterialDetailModal({
  item,
  canIssue,
  onClose,
}: {
  item: BalanceItem;
  canIssue: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MaterialMovementRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    getMaterialRecentMovementsAction(item.key).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [item.key]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Material Details</p>
              <h2 className="mt-0.5 truncate text-base font-bold text-[#111827]">{item.display_name}</h2>
              <p className="mt-0.5 text-xs text-[#4B5563]">
                {item.category}
                {item.part_number ? ` · ${item.part_number}` : ""}
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Opening Stock" value={item.total_opening_stock} />
              <Stat label="Total Received" value={item.total_received} />
              <Stat label="Total Used" value={item.total_issued} />
              <Stat label="Current Balance" value={item.balance} highlight />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Info label="Part No." value={item.part_number ?? "—"} />
              <Info label="SS Rec. Code" value={item.ss_rec_code ?? "—"} />
              <Info label="Unit" value={item.unit} />
              <Info label="Location / Bin" value={item.location ?? "—"} />
              <Info label="Last Movement" value={fmtDate(item.last_movement_date)} />
            </div>

            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                Recent Movements for this material
              </p>
              {rows === null ? (
                <div className="flex items-center gap-2 py-4 text-sm text-[#4B5563]">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading…
                </div>
              ) : rows.length === 0 ? (
                <p className="text-sm text-[#9CA3AF]">No movements recorded.</p>
              ) : (
                <div className="divide-y divide-[#F3F4F6] rounded-md border border-[#E5E7EB]">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <StatusBadge
                          label={movementTypeLabel(r.movement_type, r.reference_number)}
                          tone={movementTypeTone(r.movement_type)}
                        />
                        <p className="mt-1 truncate text-xs text-[#9CA3AF]">
                          {fmtDate(r.movement_date)} · {r.created_by_name}
                          {r.work_order_number ? ` · ${r.work_order_number}` : ""}
                          {r.reference_number ? ` · Ref: ${r.reference_number}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 font-bold text-[#111827]">
                        {r.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })} {r.unit}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-[#E5E7EB] px-5 py-3">
            <div className="flex items-center gap-2">
              <Link
                href={`/store/offline-inventory/movements?q=${encodeURIComponent(item.display_name)}`}
                className="flex-1 rounded-md border border-[#E5E7EB] px-4 py-2 text-center text-sm font-bold text-[#111827] hover:bg-gray-50"
              >
                Full Movement History
              </Link>
              {canIssue && (
                item.balance > 0 ? (
                  <Link
                    href={`/store/offline-inventory/issue?material=${encodeURIComponent(item.key)}`}
                    className="flex-1 rounded-md bg-[#ED1C24] px-4 py-2 text-center text-sm font-bold text-white hover:bg-[#c8181e]"
                  >
                    Record Used Material
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    title="No available balance to record as used."
                    className="flex-1 cursor-not-allowed rounded-md bg-gray-100 px-4 py-2 text-center text-sm font-bold text-[#9CA3AF]"
                  >
                    Record Used Material
                  </button>
                )
              )}
            </div>
            {canIssue && item.balance <= 0 && (
              <p className="mt-2 text-xs text-[#9CA3AF]">No available balance to record as used.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
