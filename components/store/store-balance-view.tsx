"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { MaterialDetailModal } from "@/components/store/material-detail-modal";
import { AddNewMaterialForm } from "@/components/store/add-new-material-form";
import { ReceiveMaterialForm } from "@/components/store/receive-material-form";
import { IssueMaterialForm } from "@/components/store/issue-material-form";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import {
  MATERIAL_CATEGORIES,
  fmtDate,
  inputCls as inp,
  labelCls as lbl,
  type BalanceItem,
  type WorkOrderOption,
} from "@/components/store/offline-inventory-types";

export interface StoreBalanceViewProps {
  balanceItems: BalanceItem[];
  totalOpeningStock: number;
  totalReceived: number;
  totalIssued: number;
  balance: number;
  canManage: boolean;
  isSuperAdmin: boolean;
  // Large Popup Conversion — Add New Material / Receive Material / Issue
  // Material open as modals from this page (server-resolved from the
  // ?addMaterial= / ?receiveMaterial= / ?issueMaterial= query params).
  workOrders: WorkOrderOption[];
  showAddMaterial: boolean;
  showReceiveMaterial: boolean;
  showIssueMaterial: boolean;
  receiveMaterialKey: string | null;
  issueMaterialKey: string | null;
  // Required Materials Issue and Shortage Tracking Unit 6: set when the
  // modal was opened from a Job Card's Materials section "Issue" link
  // (`?workOrder=<id>`), so the issue is attributed to that Job Card.
  issueWorkOrderId: string | null;
}

type Tone5 = "green" | "red" | "blue" | "amber" | "gray";
type BalanceStatus = "all" | "available" | "zero";

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
  workOrders,
  showAddMaterial,
  showReceiveMaterial,
  showIssueMaterial,
  receiveMaterialKey,
  issueMaterialKey,
  issueWorkOrderId,
}: StoreBalanceViewProps) {
  const router = useRouter();
  const [search, setSearch]             = useState("");
  const [category, setCategory]         = useState<string | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>("all");
  // Task 9 (Offline Inventory Action Visibility Fix): store the key of the
  // viewed row, not a snapshot of the item — AutoRefresh/RealtimeRefresh
  // re-fetch balanceItems and re-render this component with new objects, so
  // deriving viewItem from the current balanceItems on every render (instead
  // of holding a stale BalanceItem in state) keeps an open Material Details
  // modal's Current Balance in sync with a concurrent Receive/Issue. If the
  // material disappeared entirely, the modal simply closes.
  const [viewKey, setViewKey]           = useState<string | null>(null);
  const viewItem = viewKey ? balanceItems.find((b) => b.key === viewKey) ?? null : null;

  const isEmpty = balanceItems.length === 0;
  const balanceTone: Tone5 = balance < 0 ? "red" : balance === 0 ? "gray" : "green";
  const hasActiveFilters = search.trim() !== "" || category !== null || balanceStatus !== "all";

  function resetFilters() {
    setSearch("");
    setCategory(null);
    setBalanceStatus("all");
  }

  // Large Popup Conversion: closing any of the three form modals just
  // removes its query param, landing back on the plain Offline Inventory
  // Control URL — no full page reload, and it re-renders with fresh
  // server data if anything changed underneath.
  function closeFormModal() {
    router.push("/store/offline-inventory", { scroll: false });
  }

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of balanceItems) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return counts;
  }, [balanceItems]);

  // Add New Material Category Flexibility Cleanup Task 6: derive the filter
  // options from the actual balance data instead of only the fixed
  // MATERIAL_CATEGORIES list, so a custom category added via "+ Add New
  // Category" shows up here too. Known categories keep their original
  // display order; any custom categories are appended, sorted alphabetically.
  const visibleCategories = useMemo(() => {
    const known = MATERIAL_CATEGORIES.filter((c) => (categoryCounts.get(c) ?? 0) > 0);
    const knownSet = new Set<string>(MATERIAL_CATEGORIES);
    const custom = Array.from(categoryCounts.keys())
      .filter((c) => !knownSet.has(c))
      .sort((a, b) => a.localeCompare(b));
    return [...known, ...custom];
  }, [categoryCounts]);

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
        description="Track maintenance materials, received quantities, issued quantities, and current balance."
        actions={
          <Link href="/store/offline-inventory/movements" className={secondaryBtn}>
            <Activity className="h-4 w-4" aria-hidden />
            View Movement History
          </Link>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {/* Simplification Task 2: one unified "Material Actions" section —
            Add New Material / Receive Material / Issue Material / View
            Movement History — for every canManage role. Setup actions
            (Add Opening Stock / Import Opening Stock) are one-time,
            pre-go-live steps and stay tucked away for Super Admin only so
            Data Entry/Manager aren't shown actions they don't need daily. */}
        {canManage && (
          <section className="space-y-3">
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-[#4B5563]">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Material Actions
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <QuickActionCard
                  href="?addMaterial=1"
                  icon={PlusCircle}
                  title="Add New Material"
                  description="Register a new material not yet tracked in Offline Inventory Control."
                />
                <QuickActionCard
                  href="?receiveMaterial=1"
                  icon={ArrowDownToLine}
                  title="Receive Material"
                  description="Record new materials received by Maintenance."
                />
                <QuickActionCard
                  href="?issueMaterial=1"
                  icon={ArrowUpFromLine}
                  title="Issue Material"
                  description="Issue materials for a Job Card or maintenance work."
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
              Search a material, check its balance, then receive or issue materials.
            </p>
          </section>
        )}
        {!canManage && (
          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm font-semibold text-[#4B5563]">
            Offline Inventory Control records maintenance material movements linked to Job Cards.
          </div>
        )}

        {/* KPI cards — Initial Stock, Received, Issued, Balance. "Initial
            Stock" is display wording only — internally this is still the
            OPENING_STOCK movement type / totalOpeningStock value, unchanged. */}
        <section className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title="Initial Stock"
            value={totalOpeningStock}
            tone="blue"
            icon={PackagePlus}
          />
          <SummaryCard
            title="Total Received"
            value={totalReceived}
            tone="green"
            icon={ArrowDownToLine}
          />
          <SummaryCard
            title="Total Issued"
            value={totalIssued}
            tone="red"
            icon={ArrowUpFromLine}
          />
          <SummaryCard
            title="Current Balance"
            value={Math.max(0, balance)}
            tone={balanceTone}
            icon={ArrowDownUp}
          />
        </section>
        <p className="-mt-2 text-xs text-[#9CA3AF]">
          Current Balance = Initial Stock + Received − Issued
        </p>

        {/* Offline Inventory Manager Access and Always-Visible Search Fix
            Task 4: search/filters used to live inside the "materials exist"
            branch below, so it vanished entirely whenever balanceItems was
            empty — the exact bug reported for both Manager and Data Entry.
            Now rendered unconditionally, right after the KPI cards, so it's
            always available even before the first material is registered. */}
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

        {/* Category summary — Simplification Task 7: compact line instead of
            a full grid of category cards; category filtering itself still
            works, just via the dropdown above. Only meaningful once at least
            one material exists — redundant with the empty-state heading below
            otherwise. */}
        {!isEmpty && (
          <p className="flex items-center gap-1.5 text-xs font-bold text-[#4B5563]">
            <Layers className="h-3.5 w-3.5" aria-hidden />
            All Materials: {balanceItems.length}
          </p>
        )}

        {/* Results area — three states: no materials registered at all yet,
            materials exist but the search/filters excluded all of them, or
            the (filtered) list itself. */}
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
                  <Link href="?addMaterial=1" className={primaryBtn}>
                    <PlusCircle className="h-4 w-4" aria-hidden />
                    Add New Material
                  </Link>
                  <Link href="?receiveMaterial=1" className={secondaryBtn}>
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
                          onClick={() => setViewKey(item.key)}
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
                                onClick={() => setViewKey(item.key)}
                                className="text-xs font-bold text-[#4B5563] hover:text-[#111827] hover:underline"
                              >
                                View
                              </button>
                              {canManage && (
                                <Link
                                  href={`?receiveMaterial=${encodeURIComponent(item.key)}`}
                                  scroll={false}
                                  className="text-xs font-bold text-[#16A34A] hover:underline"
                                >
                                  Receive More
                                </Link>
                              )}
                              {canManage && item.balance > 0 && (
                                <Link
                                  href={`?issueMaterial=${encodeURIComponent(item.key)}`}
                                  scroll={false}
                                  className="text-xs font-bold text-[#ED1C24] hover:underline"
                                >
                                  Issue
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
          </>
        )}
      </div>

      {viewItem && (
        <MaterialDetailModal item={viewItem} canIssue={canManage} onClose={() => setViewKey(null)} />
      )}

      {/* Large Popup Conversion — Add New Material / Receive Material /
          Issue Material open as modals from this page; their standalone
          pages (/add-material, /receive, /issue) still exist and still work
          for direct URL access. */}
      {showAddMaterial && (
        <LargeFormModal
          title="Add New Material"
          subtitle="Register a new material in Offline Inventory Control."
          onClose={closeFormModal}
        >
          <AddNewMaterialForm modalMode />
        </LargeFormModal>
      )}
      {showReceiveMaterial && (
        <LargeFormModal
          title="Receive Material"
          subtitle="Record material received for maintenance."
          onClose={closeFormModal}
        >
          <ReceiveMaterialForm
            modalMode
            presetMaterialKey={receiveMaterialKey}
            knownMaterials={balanceItems}
            workOrders={workOrders}
          />
        </LargeFormModal>
      )}
      {showIssueMaterial && (
        <LargeFormModal
          title="Issue Material"
          subtitle="Issue materials for a Job Card or maintenance work."
          onClose={closeFormModal}
        >
          <IssueMaterialForm
            modalMode
            presetMaterialKey={issueMaterialKey}
            presetWorkOrderId={issueWorkOrderId}
            availableItems={balanceItems.filter((b) => b.balance > 0)}
            workOrders={workOrders}
          />
        </LargeFormModal>
      )}
    </>
  );
}
