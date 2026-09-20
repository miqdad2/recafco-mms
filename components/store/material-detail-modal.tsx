"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  getMaterialRecentMovementsAction,
  getMaterialCostSummaryAction,
  type MaterialMovementRow,
  type MaterialCostSummary,
} from "@/app/actions/offline-inventory";
import {
  fmtDate,
  movementTypeLabel,
  movementTypeTone,
  stockStatusLabel,
  stockStatusTone,
  type BalanceItem,
} from "@/components/store/offline-inventory-types";

function Stat({
  label,
  value,
  highlight,
  money = false,
  note,
}: {
  label: string;
  value: number | null;
  highlight?: boolean;
  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 11 — KWD
  // amounts show a fixed 3 decimals; every pre-existing quantity Stat
  // keeps its original "up to 2 decimals, no forced trailing zeros"
  // formatting unchanged. value: null (e.g. no priced movement recorded
  // yet) shows "—" instead of a misleading 0. `note` replaces the number
  // entirely (e.g. "Review required" for a negative balance).
  money?: boolean;
  note?: string;
}) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-4 text-center">
      <p className={`text-xl font-black ${highlight ? "text-[#ED1C24]" : "text-[#111827]"}`}>
        {note ??
          (value === null
            ? "—"
            : money
              ? value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })
              : value.toLocaleString("en-US", { maximumFractionDigits: 2 }))}
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
  onClose,
  canViewCosts = false,
}: {
  item: BalanceItem;
  onClose: () => void;
  canViewCosts?: boolean;
}) {
  const [rows, setRows] = useState<MaterialMovementRow[] | null>(null);
  const [costSummary, setCostSummary] = useState<MaterialCostSummary | null>(null);

  useEffect(() => {
    let alive = true;
    getMaterialRecentMovementsAction(item.key).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [item.key]);

  // Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63,
  // Task 10 — only fetched for a cost-permitted viewer; the action itself
  // would return zeros for anyone else, but there's no reason to make the
  // round trip at all when the section won't render.
  useEffect(() => {
    if (!canViewCosts) return;
    let alive = true;
    getMaterialCostSummaryAction(item.key).then((s) => {
      if (alive) setCostSummary(s);
    });
    return () => {
      alive = false;
    };
  }, [item.key, canViewCosts]);

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
                  <Info label="Last Movement Date" value={fmtDate(item.last_movement_date)} />
                </div>
              </section>

              {/* Right column — Current Stock (Task 7's "1. Current Stock"
                  section: balance/unit/minimum/reorder/status/location). */}
              <section>
                <SectionTitle>Current Stock</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Current Balance" value={item.balance} highlight />
                  <div className="rounded-md border border-[#E5E7EB] bg-white p-4 text-center">
                    <p className="text-xl font-black text-[#111827]">{item.unit}</p>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[#4B5563]">Unit</p>
                  </div>
                  <Stat label="Minimum Stock Level" value={item.minimum_stock_quantity} />
                  <Stat label="Reorder Quantity" value={item.reorder_quantity} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-[#E5E7EB] bg-white px-4 py-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-[#9CA3AF]">Stock Status</span>
                  <StatusBadge label={stockStatusLabel(item.stock_status)} tone={stockStatusTone(item.stock_status)} />
                </div>
                {/* Task 10 — explains why a balance of 1 (or less) shows
                    Low Stock/Out of Stock/Negative Stock even though no
                    minimum was ever configured for this material. */}
                {item.minimum_stock_quantity === null && (
                  <p className="mt-2 text-[11px] text-[#9CA3AF]">
                    Default low stock rule: 1 or less needs attention.
                  </p>
                )}
                <div className="mt-3 divide-y divide-[#F3F4F6] rounded-md border border-[#E5E7EB] px-4">
                  <Info label="Location / Bin" value={item.location ?? "—"} />
                  <Info label="Initial Stock" value={`${item.total_opening_stock.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${item.unit}`} />
                  <Info label="Total Received" value={`${item.total_received.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${item.unit}`} />
                  <Info label="Total Issued" value={`${item.total_issued.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${item.unit}`} />
                </div>
                {/* Task 10 — never hidden, and explains the "why" plainly. */}
                {item.stock_status === "negative" && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[#ED1C24]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Issued quantity is greater than received quantity. Please review inventory movements.
                  </p>
                )}
                {item.stock_status === "review_required" && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[#ED1C24]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    This material name appears under more than one unit in Inventory Control. Please review for a possible data-entry mismatch.
                  </p>
                )}
              </section>
            </div>

            {/* Cost Summary (Task 7's "2. Cost Summary") — cost-permitted
                roles only; Data Entry and other non-cost roles never see
                this section at all. */}
            {canViewCosts && (
              <section>
                <SectionTitle>Cost Summary</SectionTitle>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Last Unit Cost (KWD)" value={item.last_unit_cost} money />
                  <Stat
                    label="Current Stock Value (KWD)"
                    value={item.stock_value}
                    money
                    note={item.stock_status === "negative" ? "Review required" : undefined}
                  />
                  <Stat label="Total Received Value (KWD)" value={item.received_value} money />
                  <Stat label="Total Issued Value (KWD)" value={item.issued_value} money />
                </div>
                {/* Task 10 — this material's own week/month/year issued
                    spend, and this month's received value; loads a moment
                    after the section itself (a small, separate action). */}
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Issued Value This Week (KWD)" value={costSummary?.issuedValueThisWeek ?? null} money />
                  <Stat label="Issued Value This Month (KWD)" value={costSummary?.issuedValueThisMonth ?? null} money />
                  <Stat label="Issued Value This Year (KWD)" value={costSummary?.issuedValueThisYear ?? null} money />
                  <Stat label="Received Value This Month (KWD)" value={costSummary?.receivedValueThisMonth ?? null} money />
                </div>
                <p className="mt-2 text-[11px] text-[#9CA3AF]">
                  Current estimated stock value based on latest unit cost. Issued/Received values are estimated from
                  inventory issue and receive movements — not a final accounting expense.
                </p>
              </section>
            )}

            {/* Recent Movements (Task 7's "3. Recent Movements") */}
            <section>
              <SectionTitle>Recent Movements</SectionTitle>
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
                          <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Date</p>
                          <p className="mt-0.5 font-semibold text-[#111827]">{fmtDate(r.movement_date)}</p>
                        </div>
                        {/* Task 7/8 — the same two underlying fields
                            (work_order_number/reference_number) are labeled
                            by what they actually mean for this movement:
                            a Job Card reference on an Issued movement, or a
                            purchase reference (e.g. a General Inventory
                            Request number, possibly with the original
                            purchase qty/unit appended — see Unit 10G.58A)
                            on a Received movement. */}
                        {r.movement_type === "ISSUED" && r.work_order_number && (
                          <div>
                            <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Job Card Reference</p>
                            <p className="mt-0.5 font-semibold text-[#111827]">{r.work_order_number}</p>
                          </div>
                        )}
                        {r.movement_type === "RECEIVED" && r.reference_number && (
                          <div>
                            <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Purchase Reference</p>
                            <p className="mt-0.5 font-semibold text-[#111827]">{r.reference_number}</p>
                          </div>
                        )}
                        {r.movement_type !== "ISSUED" && r.movement_type !== "RECEIVED" && r.reference_number && (
                          <div>
                            <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Reference No.</p>
                            <p className="mt-0.5 font-semibold text-[#111827]">{r.reference_number}</p>
                          </div>
                        )}
                        <div>
                          <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Entered By</p>
                          <p className="mt-0.5 font-semibold text-[#111827]">{r.created_by_name}</p>
                        </div>
                        {canViewCosts && r.unit_cost !== null && (
                          <div>
                            <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Unit Cost (KWD)</p>
                            <p className="mt-0.5 font-semibold text-[#111827]">{r.unit_cost.toFixed(3)}</p>
                          </div>
                        )}
                        {canViewCosts && r.total_cost !== null && (
                          <div>
                            <p className="font-bold uppercase tracking-wide text-[#9CA3AF]">Total Cost (KWD)</p>
                            <p className="mt-0.5 font-semibold text-[#111827]">{r.total_cost.toFixed(3)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Footer — non-scrolling, stays visible below the body's own
              scroll area. Inventory Control Page Simplification Unit
              10G.16, Task 4: "Receive More"/"Issue Material" removed from
              here too — this modal is opened only from the Inventory
              Control table's generic "View" row action, so it follows the
              same "safe review page" rule as the row/card actions. Receive/
              Issue remain available through Daily Activity. */}
          <div className="border-t border-[#E5E7EB] px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href={`/store/offline-inventory/movements?q=${encodeURIComponent(item.display_name)}`}
                className="inline-flex items-center justify-center rounded-md border border-[#E5E7EB] px-5 py-2.5 text-sm font-bold text-[#111827] hover:bg-gray-50"
              >
                View Full History
              </Link>
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
    </>
  );
}
