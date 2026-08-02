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
    <div className="rounded-md border border-[#E5E7EB] bg-white p-4 text-center">
      <p className={`text-xl font-black ${highlight ? "text-[#ED1C24]" : "text-[#111827]"}`}>
        {value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
      </p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[#4B5563]">{label}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-[#9CA3AF]">{label}</p>
      <p className="truncate text-sm font-semibold text-[#111827]">{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">{children}</h3>
  );
}

function balanceTone(balance: number): "green" | "amber" | "red" {
  if (balance < 0) return "red";
  if (balance === 0) return "amber";
  return "green";
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
          className="flex max-h-[85vh] w-[min(85vw,1200px)] flex-col rounded-xl bg-white shadow-2xl"
        >
          {/* Header — non-scrolling, stays visible above the body's own scroll area */}
          <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-6 py-5">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Material Details</p>
              <h2 className="mt-1 truncate text-xl font-black text-[#111827]">{item.display_name}</h2>
              <p className="mt-0.5 text-sm text-[#4B5563]">
                {item.category}
                {item.part_number ? ` · ${item.part_number}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <StatusBadge
                label={`Current Balance: ${item.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${item.unit}`}
                tone={balanceTone(item.balance)}
              />
              <button
                onClick={onClose}
                className="shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Body — the only scrolling region */}
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Left column — Material Information */}
              <section>
                <SectionTitle>Material Information</SectionTitle>
                <div className="divide-y divide-[#F3F4F6] rounded-md border border-[#E5E7EB] px-4">
                  <Info label="Material Name" value={item.display_name} />
                  <Info label="Category" value={item.category} />
                  <Info label="Unit" value={item.unit} />
                  <Info label="Part No." value={item.part_number ?? "—"} />
                  <Info label="SS Rec. Code" value={item.ss_rec_code ?? "—"} />
                  <Info label="Location / Bin" value={item.location ?? "—"} />
                  <Info label="Last Movement Date" value={fmtDate(item.last_movement_date)} />
                </div>
              </section>

              {/* Right column — Stock Summary */}
              <section>
                <SectionTitle>Stock Summary</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Initial Stock" value={item.total_opening_stock} />
                  <Stat label="Total Received" value={item.total_received} />
                  <Stat label="Total Issued" value={item.total_issued} />
                  <Stat label="Current Balance" value={item.balance} highlight />
                </div>
              </section>
            </div>

            {/* Latest Movements */}
            <section>
              <SectionTitle>Latest Movements</SectionTitle>
              {rows === null ? (
                <div className="flex items-center gap-2 rounded-md border border-[#E5E7EB] py-6 text-sm text-[#4B5563]">
                  <Loader2 className="ml-4 h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading…
                </div>
              ) : rows.length === 0 ? (
                <p className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-6 text-center text-sm text-[#9CA3AF]">
                  No movement records found for this material.
                </p>
              ) : (
                <div className="space-y-2">
                  {rows.map((r) => (
                    <div key={r.id} className="rounded-md border border-[#E5E7EB] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <StatusBadge
                          label={movementTypeLabel(r.movement_type, r.reference_number)}
                          tone={movementTypeTone(r.movement_type)}
                        />
                        <p className="shrink-0 font-bold text-[#111827]">
                          {r.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })} {r.unit}
                        </p>
                      </div>
                      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                        <div>
                          <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Record Date</p>
                          <p className="mt-0.5 font-semibold text-[#111827]">{fmtDate(r.movement_date)}</p>
                        </div>
                        <div>
                          <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Related Job Card</p>
                          <p className="mt-0.5 font-semibold text-[#111827]">{r.work_order_number ?? "—"}</p>
                        </div>
                        <div>
                          <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Entered By</p>
                          <p className="mt-0.5 font-semibold text-[#111827]">{r.created_by_name}</p>
                        </div>
                        {r.reference_number && (
                          <div>
                            <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Reference No.</p>
                            <p className="mt-0.5 font-semibold text-[#111827]">{r.reference_number}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Footer — non-scrolling, stays visible below the body's own scroll area */}
          <div className="border-t border-[#E5E7EB] px-6 py-4">
            {canIssue && item.balance <= 0 && (
              <p className="mb-2 text-xs text-[#9CA3AF]">No available balance to issue.</p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href={`/store/offline-inventory/movements?q=${encodeURIComponent(item.display_name)}`}
                className="inline-flex items-center justify-center rounded-md border border-[#E5E7EB] px-5 py-2.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
              >
                View Full History
              </Link>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {canIssue && (
                  <Link
                    href={`?receiveMaterial=${encodeURIComponent(item.key)}`}
                    scroll={false}
                    onClick={onClose}
                    className="inline-flex items-center justify-center rounded-md bg-[#16A34A] px-5 py-2.5 text-sm font-bold text-white hover:bg-green-700"
                  >
                    Receive More
                  </Link>
                )}
                {canIssue && (
                  item.balance > 0 ? (
                    <Link
                      href={`?issueMaterial=${encodeURIComponent(item.key)}`}
                      scroll={false}
                      onClick={onClose}
                      className="inline-flex items-center justify-center rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                    >
                      Issue Material
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="No available balance to issue."
                      className="inline-flex cursor-not-allowed items-center justify-center rounded-md bg-gray-100 px-5 py-2.5 text-sm font-bold text-[#9CA3AF]"
                    >
                      Issue Material
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center justify-center rounded-md border border-[#E5E7EB] px-5 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
