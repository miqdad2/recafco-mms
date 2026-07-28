"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpFromLine,
  Layers,
  Package,
  PackagePlus,
  PlusCircle,
  RotateCcw,
  Search,
  Upload,
  Zap,
} from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { MaterialDetailModal } from "@/components/store/material-detail-modal";
import {
  MATERIAL_CATEGORIES,
  fmtDate,
  inputCls as inp,
  labelCls as lbl,
  movementTypeLabel,
  movementTypeTone,
  type BalanceItem,
  type RecentMovementRow,
} from "@/components/store/offline-inventory-types";

export interface StoreBalanceViewProps {
  balanceItems: BalanceItem[];
  totalOpeningStock: number;
  totalReceived: number;
  totalIssued: number;
  balance: number;
  canManage: boolean;
  isSuperAdmin: boolean;
  recentMovements: RecentMovementRow[];
}

type Tone5 = "green" | "red" | "blue" | "amber" | "gray";
type BalanceStatus = "all" | "available" | "zero";
type MovementFilter = "ALL" | "OPENING_STOCK" | "RECEIVED" | "ISSUED";

const secondaryBtn =
  "inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50";
const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]";

function SummaryCard({
  title,
  value,
  tone,
  icon: Icon,
  onClick,
  active,
}: {
  title: string;
  value: number;
  tone: Tone5;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onClick?: () => void;
  active?: boolean;
}) {
  const bg: Record<Tone5, string> = {
    green: "bg-[#16A34A]",
    red:   "bg-[#ED1C24]",
    blue:  "bg-[#2563EB]",
    amber: "bg-[#F59E0B]",
    gray:  "bg-[#111827]",
  };
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full rounded-md border bg-white p-4 text-left shadow-sm transition ${
        onClick ? "cursor-pointer hover:border-[#ED1C24]/40 hover:bg-gray-50" : ""
      } ${active ? "border-[#ED1C24] ring-1 ring-[#ED1C24]" : "border-[#E5E7EB]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-md p-2 text-white ${bg[tone]}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <span className="text-2xl font-black text-[#111827]">
          {value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </span>
      </div>
      <p className="mt-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">{title}</p>
    </Wrapper>
  );
}

function QuickActionCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm transition hover:border-[#ED1C24] hover:shadow-md"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-[#ED1C24] transition group-hover:bg-[#ED1C24] group-hover:text-white">
        <Icon className="h-4.5 w-4.5" aria-hidden />
      </span>
      <p className="text-sm font-bold text-[#111827]">{title}</p>
      <p className="text-xs leading-relaxed text-[#4B5563]">{description}</p>
    </Link>
  );
}

export function StoreBalanceView({
  balanceItems,
  totalOpeningStock,
  totalReceived,
  totalIssued,
  balance,
  canManage,
  isSuperAdmin,
  recentMovements,
}: StoreBalanceViewProps) {
  const [search, setSearch]             = useState("");
  const [category, setCategory]         = useState<string | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>("all");
  const [viewItem, setViewItem]         = useState<BalanceItem | null>(null);
  const [movementFilter, setMovementFilter] = useState<MovementFilter>("ALL");

  const isEmpty = balanceItems.length === 0;
  const balanceTone: Tone5 = balance < 0 ? "red" : balance === 0 ? "gray" : "green";
  const hasActiveFilters = search.trim() !== "" || category !== null || balanceStatus !== "all";

  function resetFilters() {
    setSearch("");
    setCategory(null);
    setBalanceStatus("all");
  }

  const filteredMovements = useMemo(() => {
    if (movementFilter === "ALL") return recentMovements;
    return recentMovements.filter((m) => m.movement_type === movementFilter);
  }, [recentMovements, movementFilter]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of balanceItems) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return counts;
  }, [balanceItems]);

  const visibleCategories = MATERIAL_CATEGORIES.filter((c) => (categoryCounts.get(c) ?? 0) > 0);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balanceItems.filter((item) => {
      if (category && item.category !== category) return false;
      if (balanceStatus === "available" && item.balance <= 0) return false;
      if (balanceStatus === "zero" && item.balance > 0) return false;
      if (q) {
        const haystack = `${item.display_name} ${item.part_number ?? ""} ${item.ss_rec_code ?? ""} ${item.category} ${item.location ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [balanceItems, search, category, balanceStatus]);

  return (
    <>
      <PageHeader
        title="Offline Inventory Control"
        description="Track maintenance materials, received quantities, used quantities, and current balance."
        actions={
          <Link href="/store/offline-inventory/movements" className={secondaryBtn}>
            <Activity className="h-4 w-4" aria-hidden />
            View Movement History
          </Link>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* Simplification Task 2: one unified "Inventory Actions" section —
            Add New Material / Receive Material / Record Used Material / View
            Movement History — for every canManage role. Setup actions
            (Add Opening Stock / Import Opening Stock) are one-time,
            pre-go-live steps and stay tucked away for Super Admin only so
            Data Entry/Manager aren't shown actions they don't need daily. */}
        {canManage && (
          <section className="space-y-3">
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Inventory Actions
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <QuickActionCard
                  href="/store/offline-inventory/add-material"
                  icon={PlusCircle}
                  title="Add New Material"
                  description="Register a new material not yet tracked in Offline Inventory Control."
                />
                <QuickActionCard
                  href="/store/offline-inventory/receive"
                  icon={ArrowDownToLine}
                  title="Receive Material"
                  description="Record new materials received by Maintenance."
                />
                <QuickActionCard
                  href="/store/offline-inventory/issue"
                  icon={ArrowUpFromLine}
                  title="Record Used Material"
                  description="Record materials used for a Job Card or maintenance work."
                />
                <QuickActionCard
                  href="/store/offline-inventory/movements"
                  icon={Activity}
                  title="View Movement History"
                  description="See every material movement recorded to date."
                />
              </div>
            </div>
            {isSuperAdmin && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                  <Zap className="h-3.5 w-3.5" aria-hidden />
                  Setup Actions
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <QuickActionCard
                    href="/store/offline-inventory/opening-stock"
                    icon={PackagePlus}
                    title="Add Opening Stock"
                    description="Enter materials already available for maintenance tracking."
                  />
                  <QuickActionCard
                    href="/store/offline-inventory/import-opening-stock"
                    icon={Upload}
                    title="Import Opening Stock"
                    description="Upload existing maintenance materials from Excel."
                  />
                </div>
                <p className="mt-2 text-xs text-[#9CA3AF]">
                  Use Add Opening Stock or Import Opening Stock before system go-live to enter existing
                  maintenance materials.
                </p>
              </div>
            )}
            <p className="text-xs text-[#9CA3AF]">
              Search a material, check its balance, then receive or record used materials.
            </p>
          </section>
        )}
        {!canManage && (
          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm font-semibold text-[#4B5563]">
            Offline Inventory Control records maintenance material movements linked to Job Cards.
          </div>
        )}

        {/* KPI cards — Opening Stock, Received, Issued, Balance */}
        <section className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title="Opening Stock"
            value={totalOpeningStock}
            tone="blue"
            icon={PackagePlus}
            active={movementFilter === "OPENING_STOCK"}
            onClick={() =>
              setMovementFilter((f) => (f === "OPENING_STOCK" ? "ALL" : "OPENING_STOCK"))
            }
          />
          <SummaryCard
            title="Total Received"
            value={totalReceived}
            tone="green"
            icon={ArrowDownToLine}
            active={movementFilter === "RECEIVED"}
            onClick={() => setMovementFilter((f) => (f === "RECEIVED" ? "ALL" : "RECEIVED"))}
          />
          <SummaryCard
            title="Total Used"
            value={totalIssued}
            tone="red"
            icon={ArrowUpFromLine}
            active={movementFilter === "ISSUED"}
            onClick={() => setMovementFilter((f) => (f === "ISSUED" ? "ALL" : "ISSUED"))}
          />
          {/* Current Balance's border/ring is deliberately never driven by the
              "selected filter" active state (unlike the other three cards) —
              `movementFilter` defaults to "ALL" on load, which used to make
              this card always render with the red "selected" ring even when
              nothing was actually wrong, regardless of the real balance. Its
              only color signal is `balanceTone` (icon badge: green positive /
              gray zero / red negative), so a positive balance never shows red. */}
          <SummaryCard
            title="Current Balance"
            value={Math.max(0, balance)}
            tone={balanceTone}
            icon={ArrowDownUp}
            onClick={() => setMovementFilter("ALL")}
          />
        </section>
        <p className="-mt-2 text-xs text-[#9CA3AF]">
          Current Balance = Opening Stock + Received − Used
        </p>

        {/* Empty state */}
        {isEmpty ? (
          <div className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex flex-col items-center gap-6 px-4 py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F5F6F8]">
                <Package className="h-8 w-8 text-[#9CA3AF]" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-black text-[#111827]">No materials found.</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                  {canManage
                    ? "Add a new material to start tracking inventory."
                    : "Materials received and tracked against Job Cards will appear here."}
                </p>
              </div>
              {canManage && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Link href="/store/offline-inventory/add-material" className={primaryBtn}>
                    <PlusCircle className="h-4 w-4" aria-hidden />
                    Add New Material
                  </Link>
                  <Link href="/store/offline-inventory/receive" className={secondaryBtn}>
                    <ArrowDownToLine className="h-4 w-4" aria-hidden />
                    Receive Material
                  </Link>
                  {isSuperAdmin && (
                    <>
                      <Link href="/store/offline-inventory/opening-stock" className={secondaryBtn}>
                        <PackagePlus className="h-4 w-4" aria-hidden />
                        Add Opening Stock
                      </Link>
                      <Link href="/store/offline-inventory/import-opening-stock" className={secondaryBtn}>
                        <Upload className="h-4 w-4" aria-hidden />
                        Import Opening Stock
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Category summary — Simplification Task 7: compact line instead
                of a full grid of category cards; category filtering itself
                still works, just via the dropdown below. */}
            <p className="flex items-center gap-1.5 text-xs font-bold text-[#4B5563]">
              <Layers className="h-3.5 w-3.5" aria-hidden />
              All Materials: {balanceItems.length}
            </p>

            {/* Search + filters */}
            <section className="grid gap-3 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm sm:grid-cols-[2fr_1fr_1fr_auto]">
              <div>
                <label htmlFor="sb-search" className={lbl}>Search</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden />
                  <input
                    id="sb-search"
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search material name, part no., SS Rec. Code, category, or location…"
                    className={`${inp} pl-9`}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="sb-category" className={lbl}>Category</label>
                <select
                  id="sb-category"
                  value={category ?? ""}
                  onChange={(e) => setCategory(e.target.value || null)}
                  className={inp}
                >
                  <option value="">All Materials</option>
                  {visibleCategories.map((c) => (
                    <option key={c} value={c}>{c} ({categoryCounts.get(c) ?? 0})</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sb-status" className={lbl}>Balance Status</label>
                <select
                  id="sb-status"
                  value={balanceStatus}
                  onChange={(e) => setBalanceStatus(e.target.value as BalanceStatus)}
                  className={inp}
                >
                  <option value="all">All</option>
                  <option value="available">Available</option>
                  <option value="zero">Zero Balance</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={resetFilters}
                  disabled={!hasActiveFilters}
                  className={`${secondaryBtn} h-[42px] disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Reset
                </button>
              </div>
            </section>

            {/* Balance table */}
            {filteredItems.length === 0 ? (
              <div className="rounded-md border border-[#E5E7EB] bg-white p-10 text-center shadow-sm">
                <h2 className="text-sm font-black text-[#111827]">No matching materials found.</h2>
                <p className="mt-1.5 text-sm text-[#4B5563]">
                  Try another material name, part no., or SS Rec. Code.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 text-xs font-bold text-[#ED1C24] hover:underline"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-3">Material</th>
                        <th className="px-4 py-3 text-right">Balance</th>
                        <th className="px-4 py-3">Unit</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Part No.</th>
                        <th className="hidden px-4 py-3 lg:table-cell">SS Rec. Code</th>
                        <th className="hidden px-4 py-3 lg:table-cell">Location / Bin</th>
                        <th className="hidden px-4 py-3 lg:table-cell">Last Movement</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filteredItems.map((item) => (
                        <tr
                          key={item.key}
                          onClick={() => setViewItem(item)}
                          className="cursor-pointer hover:bg-gray-50"
                        >
                          <td className="px-4 py-3 font-semibold text-[#111827]">{item.display_name}</td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={`font-black ${
                                item.balance > 0
                                  ? "text-[#111827]"
                                  : item.balance < 0
                                  ? "text-[#ED1C24]"
                                  : "text-amber-600"
                              }`}
                            >
                              {item.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">{item.unit}</td>
                          <td className="px-4 py-3 text-xs text-[#4B5563]">{item.category}</td>
                          <td className="px-4 py-3 text-xs text-[#4B5563]">{item.part_number ?? "—"}</td>
                          <td className="hidden px-4 py-3 text-xs text-[#4B5563] lg:table-cell">
                            {item.ss_rec_code ?? "—"}
                          </td>
                          <td className="hidden px-4 py-3 text-xs text-[#4B5563] lg:table-cell">
                            {item.location ?? "—"}
                          </td>
                          <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-[#4B5563] lg:table-cell">
                            {fmtDate(item.last_movement_date)}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => setViewItem(item)}
                                className="text-xs font-bold text-[#4B5563] hover:text-[#111827] hover:underline"
                              >
                                View
                              </button>
                              {canManage && (
                                <Link
                                  href={`/store/offline-inventory/receive?material=${encodeURIComponent(item.key)}`}
                                  className="text-xs font-bold text-[#16A34A] hover:underline"
                                >
                                  Receive
                                </Link>
                              )}
                              {canManage && item.balance > 0 && (
                                <Link
                                  href={`/store/offline-inventory/issue?material=${encodeURIComponent(item.key)}`}
                                  className="text-xs font-bold text-[#ED1C24] hover:underline"
                                >
                                  Record Used
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent Movements */}
            <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-5 py-3">
                <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                  <Activity className="h-3.5 w-3.5" aria-hidden />
                  Recent Movements
                </div>
                <Link
                  href="/store/offline-inventory/movements"
                  className="text-xs font-bold text-[#ED1C24] hover:underline"
                >
                  View Full Movement History
                </Link>
              </div>
              {filteredMovements.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#4B5563]">
                  No movements of this type yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Material</th>
                        <th className="hidden px-4 py-3 lg:table-cell">Category</th>
                        <th className="px-4 py-3 text-right">Quantity</th>
                        <th className="px-4 py-3">Unit</th>
                        <th className="hidden px-4 py-3 lg:table-cell">Related Job Card</th>
                        <th className="hidden px-4 py-3 lg:table-cell">Reference No.</th>
                        <th className="px-4 py-3">Entered By</th>
                        <th className="hidden px-4 py-3 lg:table-cell">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filteredMovements.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3 text-[#111827]">{fmtDate(m.movement_date)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              label={movementTypeLabel(m.movement_type, m.reference_number)}
                              tone={movementTypeTone(m.movement_type)}
                            />
                          </td>
                          <td className="px-4 py-3 font-semibold text-[#111827]">{m.material_name}</td>
                          <td className="hidden px-4 py-3 text-xs text-[#4B5563] lg:table-cell">{m.category}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-[#111827]">
                            {m.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">{m.unit}</td>
                          <td className="hidden px-4 py-3 lg:table-cell">
                            {m.related_work_order_id ? (
                              <Link
                                href={`/maintenance/work-orders/${m.related_work_order_id}`}
                                className="text-xs font-bold text-[#ED1C24] hover:underline"
                              >
                                {m.work_order_number ?? "View"}
                              </Link>
                            ) : (
                              <span className="text-[#9CA3AF]">—</span>
                            )}
                          </td>
                          <td className="hidden px-4 py-3 text-xs text-[#4B5563] lg:table-cell">
                            {m.reference_number ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-[#4B5563]">{m.created_by_name}</td>
                          <td className="hidden max-w-[200px] truncate px-4 py-3 text-xs text-[#4B5563] lg:table-cell">
                            {m.remarks ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {viewItem && (
        <MaterialDetailModal item={viewItem} canIssue={canManage} onClose={() => setViewItem(null)} />
      )}
    </>
  );
}
