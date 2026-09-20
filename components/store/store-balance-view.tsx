"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  Boxes,
  ChevronRight,
  Info,
  Layers,
  Package,
  PackagePlus,
  PlusCircle,
  Printer,
  RotateCcw,
  Search,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
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
  stockStatusLabel,
  stockStatusTone,
  type BalanceItem,
  type StockStatus,
  type WorkOrderOption,
  type InventorySpendingSummary,
} from "@/components/store/offline-inventory-types";
import { StatusBadge } from "@/components/ui/status-badge";

export interface StoreBalanceViewProps {
  balanceItems: BalanceItem[];
  totalReceived: number;
  totalIssued: number;
  balance: number;
  canManage: boolean;
  isSuperAdmin: boolean;
  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 5/6 —
  // gates the Unit Cost/Stock Value table columns, the Current Stock Value
  // summary card, and the Opening Unit Cost field on Add New Material.
  canViewCosts: boolean;
  totalStockValue: number;
  // Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63,
  // Task 2 — count of Low Stock/Out of Stock/Negative Stock/Review
  // Required items ("Needs Attention"); visible to every role (a quantity
  // signal, not a cost figure).
  lowStockCount: number;
  // Task 4/5/6/7 — every field here is cost data; already fully zeroed out
  // server-side (page.tsx's spendingSummaryForClient) for a viewer without
  // cost permission, so this component never needs its own extra check
  // before reading a number out of it (canViewCosts still gates whether
  // the sections render at all).
  spendingSummary: InventorySpendingSummary;
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
// Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63, Task
// 8 — adds "needs_attention" (Low Stock + Out of Stock + Negative Stock +
// Review Required combined) as an extra filter value on top of the 5 real
// stock_status values every badge shows, matching the "Low Stock / Needs
// Attention" summary card's own definition exactly.
type BalanceStatus = "all" | StockStatus | "needs_attention";
const NEEDS_ATTENTION_STATUSES: StockStatus[] = ["low_stock", "out_of_stock", "negative", "review_required"];

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
  decimals = 2,
}: {
  title: string;
  value: number;
  tone: Tone5;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onClick?: () => void;
  active?: boolean;
  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 11 — KWD
  // amounts use 3 decimals; the existing quantity cards keep their
  // original 2-decimal default unchanged.
  decimals?: number;
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
      className={`w-full rounded-md border bg-white p-6 text-left shadow-sm transition ${
        onClick ? "cursor-pointer hover:border-[#ED1C24]/40 hover:bg-gray-50" : ""
      } ${active ? "border-[#ED1C24] ring-1 ring-[#ED1C24]" : "border-[#E5E7EB]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-lg p-3 text-white shadow-sm ${bg[tone]}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <span className="text-3xl font-black leading-none text-[#111827] sm:text-4xl">
          {decimals === 2
            ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
            : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
        </span>
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-[#6B7280]">{title}</p>
    </Wrapper>
  );
}

// Inventory Control UI/UX Compact Dashboard Unit 10G.64, Task 1 — a smaller
// sibling of SummaryCard for the new top KPI strip: same tone/icon system,
// visibly shorter (less padding, smaller value/icon), so 4 of these plus
// filters plus the table's own header can all fit above the fold. The
// larger SummaryCard is reused as-is inside Manager Insights, where extra
// height doesn't compete with the table for space.
function CompactStatCard({
  title,
  value,
  tone,
  icon: Icon,
  onClick,
  decimals = 2,
}: {
  title: string;
  value: number;
  tone: Tone5;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onClick?: () => void;
  decimals?: number;
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
      // Unit 10G.64B, Task 1 — a fixed `min-h` keeps all 3-4 cards the
      // exact same height regardless of title length (e.g. "Low Stock /
      // Needs Attention" wrapping to two lines on a narrow card would
      // otherwise make that one card taller than its siblings), and the
      // icon now sits in a slightly larger, more clearly-bounded tile.
      className={`flex w-full min-h-[72px] items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3.5 text-left shadow-sm transition ${
        onClick ? "cursor-pointer hover:border-[#ED1C24]/40 hover:bg-gray-50 hover:shadow-md" : ""
      }`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white ${bg[tone]}`}>
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">{title}</p>
        <p className="mt-0.5 text-2xl font-black leading-tight text-[#111827]">
          {decimals === 2
            ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
            : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
        </p>
      </div>
    </Wrapper>
  );
}

export function StoreBalanceView({
  balanceItems,
  totalReceived,
  totalIssued,
  balance,
  canManage,
  isSuperAdmin,
  canViewCosts,
  totalStockValue,
  lowStockCount,
  spendingSummary,
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
  // Manager Insights Reorganization Unit 10G.64A, Task 1 — replaces the
  // 10G.64 collapsed-accordion "Manager Insights" with a top-level tab, so
  // it's visible without scrolling past the table first. Defaults to
  // "register" for every role; a non-cost viewer never gets a way to reach
  // "insights" at all (no tab bar, no preview line — see the JSX below), so
  // this state carries no cost data itself and is harmless either way.
  const [activeTab, setActiveTab] = useState<"register" | "insights">("register");

  const isEmpty = balanceItems.length === 0;
  const balanceTone: Tone5 = balance < 0 ? "red" : balance === 0 ? "gray" : "green";
  const hasActiveFilters = search.trim() !== "" || category !== null || balanceStatus !== "all";
  // Unit 10G.64B, Task 7 — whether there is any real priced activity to
  // show in Manager Insights at all; drives the "no priced inventory
  // movements recorded yet" note vs. the normal estimate disclaimer.
  const hasAnyPricedInsights =
    spendingSummary.issuedValueThisWeek !== 0 ||
    spendingSummary.issuedValueThisMonth !== 0 ||
    spendingSummary.issuedValueThisYear !== 0 ||
    spendingSummary.receivedValueThisMonth !== 0;

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

  // Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63,
  // Task 3 — "unique visible categories from inventory material
  // identities": every category already comes from a real balanceItems
  // row, so this is just the distinct count, no extra query needed.
  const totalMaterialsCount = balanceItems.length;
  const categoriesCount = useMemo(() => new Set(balanceItems.map((i) => i.category)).size, [balanceItems]);

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
      if (balanceStatus === "needs_attention" && !NEEDS_ATTENTION_STATUSES.includes(item.stock_status)) return false;
      if (balanceStatus !== "all" && balanceStatus !== "needs_attention" && item.stock_status !== balanceStatus) return false;
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
        title="Inventory Control"
        description="Track maintenance materials, received quantities, issued quantities, and current balance."
        actions={
          <>
            <PageNavigationActions secondaryLinks={[{ label: "Materials Requests", href: "/store/parts-requests" }]} />
            {/* Inventory Control UI/UX Compact Dashboard Unit 10G.64, Task
                6 — Add New Material / View Movement History moved into the
                header's own compact action bar (same buttons, no more two
                large description cards taking vertical space in the body). */}
            {canManage && (
              <Link href="?addMaterial=1" className={primaryBtn}>
                <PlusCircle className="h-4 w-4" aria-hidden />
                Add New Material
              </Link>
            )}
            <Link href="/store/offline-inventory/movements" className={secondaryBtn}>
              <Activity className="h-4 w-4" aria-hidden />
              View Movement History
            </Link>
            {/* Printable Technician Workload and Inventory Control Reports
                Unit 10G.70, Task 4 — opens the separate A4 print route
                (its own Category/Balance Status filters), same pattern as
                every other report's "Print Report" link added in 10G.69/70. */}
            <Link href="/reports/offline-inventory/print" className={secondaryBtn}>
              <Printer className="h-4 w-4" aria-hidden />
              Print Report
            </Link>
          </>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">
        {!canManage && (
          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm font-semibold text-[#4B5563]">
            Inventory Control records maintenance material movements linked to Job Cards.
          </div>
        )}

        {/* Task 6 — Setup Actions (Add Opening Stock / Import Opening
            Stock) are one-time, pre-go-live, Super-Admin-only steps; kept
            as a slim compact-button line rather than large cards, same
            space-saving move as Add New Material/View Movement History
            above. */}
        {canManage && isSuperAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/store/offline-inventory/opening-stock" className={secondaryBtn}>
              <PackagePlus className="h-4 w-4" aria-hidden />
              Add Opening Stock
            </Link>
            <Link href="/store/offline-inventory/import-opening-stock" className={secondaryBtn}>
              <Upload className="h-4 w-4" aria-hidden />
              Import Opening Stock
            </Link>
            <span className="text-xs text-[#9CA3AF]">Use before system go-live to enter existing materials.</span>
          </div>
        )}

        {/* Task 1 — compact KPI strip: 4 short cards on desktop (3 for a
            non-cost viewer), 2 on tablet, 1 on mobile. Task 8 — Low Stock /
            Needs Attention is clickable, applying the same filter the
            Balance Status dropdown's own "Needs Attention" option does. */}
        <section className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <CompactStatCard title="Total Materials" value={totalMaterialsCount} tone="blue" icon={Boxes} />
          <CompactStatCard
            title="Current Balance"
            value={Math.max(0, balance)}
            tone={balanceTone}
            icon={ArrowDownUp}
          />
          <CompactStatCard
            title="Low Stock / Needs Attention"
            value={lowStockCount}
            tone={lowStockCount > 0 ? "amber" : "green"}
            icon={AlertTriangle}
            onClick={() => setBalanceStatus("needs_attention")}
          />
          {canViewCosts && (
            <CompactStatCard title="Current Stock Value (KWD)" value={totalStockValue} tone="blue" icon={Wallet} decimals={3} />
          )}
        </section>

        {/* Task 2 — Total Received/Total Issued no longer get their own
            large cards; a small line does the same job. Task 3's helper
            note about what "Needs Attention" covers is folded in here too,
            keeping this a single compact line instead of two. */}
        <p className="-mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[#9CA3AF]">
          <span>
            Movement totals: Received <strong className="font-bold text-[#4B5563]">{totalReceived.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
            {" · "}Issued <strong className="font-bold text-[#4B5563]">{totalIssued.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
            {" · "}Categories <strong className="font-bold text-[#4B5563]">{categoriesCount}</strong>.
          </span>
          <span>Low Stock / Needs Attention includes low stock, out of stock, negative stock, and review-required items.</span>
        </p>

        {/* Unit 10G.64B, Task 2 — the same always-visible preview, restyled
            as a compact insight bar: light tinted background, a small icon,
            issued/received values as small pill "chips" instead of plain
            inline text, and a right-aligned View details link with a
            chevron. Never rendered for a non-cost viewer (Task 8). Clicking
            "View details" just switches the tab below — the numbers are
            the exact same spendingSummary values the Insights tab renders,
            already zeroed server-side for anyone without canViewCosts, so
            this bar carries nothing new to leak. */}
        {canViewCosts && (
          <div className="-mt-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50/70 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#2563EB] text-white">
                <Wallet className="h-3.5 w-3.5" aria-hidden />
              </div>
              <span className="text-xs font-black text-[#111827]">Manager Insights</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4B5563]">
                Issued this month
                <strong className="font-bold text-[#111827]">
                  {spendingSummary.issuedValueThisMonth.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KWD
                </strong>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4B5563]">
                Received this month
                <strong className="font-bold text-[#111827]">
                  {spendingSummary.receivedValueThisMonth.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KWD
                </strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("insights")}
              className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-[#ED1C24] hover:underline"
            >
              View details
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}

        {/* Unit 10G.64B, Task 3 — segmented "pill" tab control instead of a
            plain underline: a light track with a raised white pill for the
            active tab reads more clearly at a glance than a thin red
            underline did. The tab switcher itself still only exists for a
            cost-permitted viewer — a non-cost viewer has exactly one thing
            to look at, so no tab bar renders at all and the Inventory
            Register content below (gated only on its own
            `activeTab === "register"` check, which never changes for that
            viewer) remains the only view, per Task 8. */}
        {canViewCosts && (
          <div className="overflow-x-auto">
            <div className="inline-flex min-w-max gap-1 rounded-lg bg-[#F3F4F6] p-1">
              <button
                type="button"
                onClick={() => setActiveTab("register")}
                className={`whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-bold transition ${
                  activeTab === "register"
                    ? "bg-white text-[#111827] shadow-sm"
                    : "text-[#6B7280] hover:text-[#111827]"
                }`}
              >
                Inventory Register
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("insights")}
                className={`whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-bold transition ${
                  activeTab === "insights"
                    ? "bg-white text-[#111827] shadow-sm"
                    : "text-[#6B7280] hover:text-[#111827]"
                }`}
              >
                Manager Insights
              </button>
            </div>
          </div>
        )}

        {/* Task 1/3 — Inventory Register tab panel: search/filters + the
            results table, exactly as before this unit, just now shown only
            when this tab is active. For a non-cost viewer (no tab bar
            above, activeTab never leaves its "register" default) this
            renders unconditionally, same as pre-10G.64A. */}
        {activeTab === "register" && (
        <>
        {/* Offline Inventory Manager Access and Always-Visible Search Fix
            Task 4: search/filters used to live inside the "materials exist"
            branch below, so it vanished entirely whenever balanceItems was
            empty — the exact bug reported for both Manager and Data Entry.
            Now rendered unconditionally, right after the KPI cards, so it's
            always available even before the first material is registered. */}
        {/* Unit 10G.64B, Task 4 — one column on mobile, a comfortable 2-up
            grid on tablet (search+category, status+reset), and the
            original 4-up row on desktop; the panel itself just gets a
            touch more breathing room (p-4 -> p-4.5-equivalent via gap-3.5). */}
        <section className="grid gap-3.5 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
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
              <option value="ok">OK</option>
              <option value="low_stock">Low Stock</option>
              <option value="out_of_stock">Out of Stock</option>
              <option value="negative">Negative Stock</option>
              <option value="review_required">Review Required</option>
              <option value="needs_attention">Needs Attention</option>
            </select>
          </div>
          <div className="flex items-end">
            {/* Task 4 — a plain, low-emphasis ghost button when no filter is
                active (nothing to reset, so it shouldn't visually compete
                with Search/Category/Balance Status), becoming the normal
                bordered button the moment a filter is applied. */}
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
              className={`inline-flex h-[42px] w-full items-center justify-center gap-1.5 rounded-md px-3 text-sm font-bold transition sm:w-auto ${
                hasActiveFilters
                  ? "border border-[#E5E7EB] bg-white text-[#111827] hover:bg-gray-50"
                  : "cursor-not-allowed border border-transparent text-[#C4C9D1]"
              }`}
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
                  {/* Task 5 — stronger header contrast (a touch darker than
                      the plain #F9FAFB used elsewhere on this page) and a
                      slightly heavier bottom border reads as a clearer,
                      more "anchored" header without needing true sticky
                      positioning. Rows gained a hair more vertical padding
                      (py-3 -> py-3.5) for easier scanning. */}
                  <table className="w-full text-sm">
                    <thead className="border-b-2 border-[#E5E7EB] bg-[#F3F4F6] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-3">Material</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Balance</th>
                        <th className="whitespace-nowrap px-4 py-3">Unit</th>
                        <th className="whitespace-nowrap px-4 py-3">Stock Status</th>
                        <th className="hidden whitespace-nowrap px-4 py-3 text-right lg:table-cell">Minimum Stock</th>
                        {canViewCosts && <th className="whitespace-nowrap px-4 py-3 text-right">Unit Cost</th>}
                        {canViewCosts && <th className="whitespace-nowrap px-4 py-3 text-right">Stock Value</th>}
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Part No.</th>
                        <th className="hidden px-4 py-3 lg:table-cell">SS Rec. Code</th>
                        <th className="hidden px-4 py-3 lg:table-cell">Location / Bin</th>
                        <th className="hidden px-4 py-3 lg:table-cell">Last Movement</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {filteredItems.map((item) => (
                        <tr
                          key={item.key}
                          onClick={() => setViewKey(item.key)}
                          className="cursor-pointer hover:bg-gray-50"
                        >
                          <td className="px-4 py-3.5 font-semibold text-[#111827]">{item.display_name}</td>
                          <td className="px-4 py-3.5 text-right">
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
                          <td className="px-4 py-3.5 text-[#4B5563]">{item.unit}</td>
                          <td className="whitespace-nowrap px-4 py-3.5">
                            {/* Task 5 — text label always shown, never
                                color-only, per the task's explicit rule;
                                whitespace-nowrap on the cell (not just the
                                badge) is what actually stops a label like
                                "Review Required" from wrapping awkwardly. */}
                            <StatusBadge label={stockStatusLabel(item.stock_status)} tone={stockStatusTone(item.stock_status)} />
                          </td>
                          <td className="hidden whitespace-nowrap px-4 py-3.5 text-right text-xs text-[#4B5563] lg:table-cell">
                            {item.minimum_stock_quantity !== null
                              ? `${item.minimum_stock_quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${item.unit}`
                              : "—"}
                          </td>
                          {canViewCosts && (
                            <td className="whitespace-nowrap px-4 py-3.5 text-right text-[#4B5563]">
                              {item.last_unit_cost !== null ? item.last_unit_cost.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"}
                            </td>
                          )}
                          {canViewCosts && (
                            <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold text-[#111827]">
                              {item.stock_status === "negative"
                                // Task 5 — a soft amber pill instead of bold
                                // red text: still clearly a caveat, but not
                                // shouting as loud as an error would.
                                ? <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Review required</span>
                                : item.stock_value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                            </td>
                          )}
                          <td className="px-4 py-3.5 text-xs text-[#4B5563]">{item.category}</td>
                          <td className="px-4 py-3.5 text-xs text-[#4B5563]">{item.part_number ?? "—"}</td>
                          <td className="hidden px-4 py-3.5 text-xs text-[#4B5563] lg:table-cell">
                            {item.ss_rec_code ?? "—"}
                          </td>
                          <td className="hidden px-4 py-3.5 text-xs text-[#4B5563] lg:table-cell">
                            {item.location ?? "—"}
                          </td>
                          <td className="hidden whitespace-nowrap px-4 py-3.5 text-xs text-[#4B5563] lg:table-cell">
                            {fmtDate(item.last_movement_date)}
                          </td>
                          {/* Inventory Control Page Simplification Unit
                              10G.16, Task 4: "Receive More"/"Issue" row
                              actions removed — Inventory Control is now a
                              safe review page for everyone who can reach it.
                              Receive/Issue still happen through Daily
                              Activity for correct Job Card tracking. Task 5
                              (10G.64B) — a compact bordered button reads
                              more clearly as an action than the previous
                              plain underlined text link did. */}
                          <td className="whitespace-nowrap px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setViewKey(item.key)}
                              className="inline-flex items-center rounded-md border border-[#E5E7EB] px-2.5 py-1 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]"
                            >
                              View
                            </button>
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
        </>
        )}

        {/* Manager Insights Reorganization Unit 10G.64A, Task 1/4 —
            "Manager Insights" tab panel: no more collapse chrome (the tab
            switcher above already handles show/hide), and never rendered
            at all for anyone without cost permission, so there's nothing to
            leak regardless of which tab a non-cost viewer's client thinks
            is active (it can never actually reach "insights" — no button
            exists for it). Content is byte-for-byte the same cards/tables
            10G.64 already rendered inside its accordion; only the
            collapse/expand wrapper is gone. */}
        {canViewCosts && activeTab === "insights" && (
          <div className="space-y-4 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <section className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard title="Issued Value This Week (KWD)" value={spendingSummary.issuedValueThisWeek} tone="red" icon={TrendingDown} decimals={3} />
              <SummaryCard title="Issued Value This Month (KWD)" value={spendingSummary.issuedValueThisMonth} tone="red" icon={TrendingDown} decimals={3} />
              <SummaryCard title="Issued Value This Year (KWD)" value={spendingSummary.issuedValueThisYear} tone="red" icon={TrendingDown} decimals={3} />
              <SummaryCard title="Received Value This Month (KWD)" value={spendingSummary.receivedValueThisMonth} tone="green" icon={TrendingUp} decimals={3} />
            </section>

            {/* Unit 10G.64B, Task 7 — when every top card reads 0.000, the
                generic "estimated, not accounting" disclaimer alone reads
                as ambiguous (is this broken, or just genuinely empty?), so
                a clearer explanatory note replaces it in that case; the
                normal disclaimer (with its unpriced-movement count, when
                relevant) still shows once there's real data to caveat. */}
            {hasAnyPricedInsights ? (
              <p className="-mt-2 flex items-start gap-1.5 rounded-md bg-[#F9FAFB] px-3 py-2 text-xs text-[#6B7280]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" aria-hidden />
                <span>
                  Estimated from inventory issue and receive movements — not a final accounting expense.
                  {spendingSummary.unpricedIssuedCount > 0
                    ? ` ${spendingSummary.unpricedIssuedCount} issued movement${spendingSummary.unpricedIssuedCount === 1 ? "" : "s"} this year had no recorded cost and ${spendingSummary.unpricedIssuedCount === 1 ? "is" : "are"} excluded from these totals.`
                    : ""}
                </span>
              </p>
            ) : (
              <div className="-mt-2 flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50/70 px-3.5 py-2.5 text-xs text-[#4B5563]">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden />
                <span>
                  <strong className="font-bold text-[#111827]">No priced inventory movements recorded yet.</strong>{" "}
                  Values will appear after materials are received or issued with unit cost.
                </span>
              </div>
            )}

            {/* Task 6 — both report sections now always render their own
                shell (title bar + border), with a plain empty-state message
                in place of the table when there's nothing to show, instead
                of vanishing entirely — a manager sees "this section works,
                there's just no data yet," not a gap that looks accidental. */}
            <div className="overflow-hidden rounded-md border border-[#E5E7EB]">
              <div className="border-b border-[#E5E7EB] bg-[#F3F4F6] px-4 py-2.5">
                <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Material Cost by Category</p>
              </div>
              {spendingSummary.categoryCostSummary.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-2.5">Category</th>
                        <th className="px-4 py-2.5 text-right">Issued This Month (KWD)</th>
                        <th className="px-4 py-2.5 text-right">Issued This Year (KWD)</th>
                        <th className="px-4 py-2.5 text-right">Received This Month (KWD)</th>
                        <th className="px-4 py-2.5 text-right">Current Stock Value (KWD)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {spendingSummary.categoryCostSummary.map((c) => (
                        <tr key={c.category}>
                          <td className="px-4 py-2.5 font-semibold text-[#111827]">{c.category}</td>
                          <td className="px-4 py-2.5 text-right text-[#4B5563]">{c.issuedThisMonth.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-right text-[#4B5563]">{c.issuedThisYear.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-right text-[#4B5563]">{c.receivedThisMonth.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[#111827]">{c.currentStockValue.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-6 text-center text-xs text-[#9CA3AF]">No category cost data yet.</p>
              )}
            </div>

            <div className="overflow-hidden rounded-md border border-[#E5E7EB]">
              <div className="border-b border-[#E5E7EB] bg-[#F3F4F6] px-4 py-2.5">
                <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Top Issued Materials This Month</p>
              </div>
              {spendingSummary.topIssuedMaterials.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-2.5">Material</th>
                        <th className="px-4 py-2.5 text-right">Issued Quantity</th>
                        <th className="px-4 py-2.5">Unit</th>
                        <th className="px-4 py-2.5 text-right">Issued Value (KWD)</th>
                        <th className="px-4 py-2.5">Last Issued</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {spendingSummary.topIssuedMaterials.map((m) => (
                        <tr key={m.key}>
                          <td className="px-4 py-2.5 font-semibold text-[#111827]">{m.display_name}</td>
                          <td className="px-4 py-2.5 text-right text-[#4B5563]">
                            {m.issuedQuantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                          </td>
                          <td className="px-4 py-2.5 text-[#4B5563]">{m.unit}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[#111827]">{m.issuedValue.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-xs text-[#4B5563]">{fmtDate(m.lastIssuedDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-6 text-center text-xs text-[#9CA3AF]">No issued materials with cost data this month.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {viewItem && (
        <MaterialDetailModal item={viewItem} onClose={() => setViewKey(null)} canViewCosts={canViewCosts} />
      )}

      {/* Large Popup Conversion — Add New Material / Receive Material /
          Issue Material open as modals from this page; their standalone
          pages (/add-material, /receive, /issue) still exist and still work
          for direct URL access.
          Inventory Control Page Simplification Unit 10G.16, Task 3: the
          Receive/Issue modals below are no longer reachable from any
          generic card/row/button on this page (Task 2/4), but the
          ?receiveMaterial=/?issueMaterial= param handling itself is left
          fully intact — a Job Card's Materials section "Issue" link (see
          app/(dashboard)/maintenance/work-orders/[id]/page.tsx) still deep-
          links here with a specific work order attached, and must keep
          working. */}
      {showAddMaterial && (
        <LargeFormModal
          title="Add New Material"
          subtitle="Register a new material in Inventory Control."
          onClose={closeFormModal}
        >
          <AddNewMaterialForm modalMode canViewCosts={canViewCosts} />
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
