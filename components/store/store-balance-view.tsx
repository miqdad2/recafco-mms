"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  History,
  ChevronDown,
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
  isReviewIssue,
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
  // Staff-Friendly Default View — ISO time; a material touched at or after
  // it counts as "recent" (Recent Materials tab, Recently Updated card and
  // quick filter). Computed on the server so render stays pure.
  recentSince: string;
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
// Balance Status dropdown values. It is a second way to reach the same
// views as the tabs; "ok" is the one status without a tab (All Materials
// filtered to OK).
type StatusFilter = "all" | "ok" | "low_stock" | "out_of_stock" | "review_issues";

const secondaryBtn =
  "inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50";
const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]";
const pagerBtn =
  "rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-[#C4C9D1] disabled:hover:bg-white";

type QuickFilters = { hasPartNo: boolean; hasSsCode: boolean; noLocation: boolean };
const NO_QUICK_FILTERS: QuickFilters = { hasPartNo: false, hasSsCode: false, noLocation: false };
const QUICK_FILTERS: { key: keyof QuickFilters; label: string }[] = [
  { key: "hasPartNo", label: "Has Part No." },
  { key: "hasSsCode", label: "Has SS Rec. Code" },
  { key: "noLocation", label: "No Location" },
];

function quickChipClass(on: boolean) {
  return `rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition ${
    on ? "border-[#111827] bg-[#111827] text-white" : "border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-gray-50"
  }`;
}

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

// Staff-Friendly Default View — the register's tabs, in daily-use order.
// Negative stock is not a normal operating category, so it has no tab of
// its own: it only appears under Review Issues (and in All Materials).
type RegisterTab = "recent" | "all" | "out_of_stock" | "low_stock" | "category" | "review";

const REGISTER_TABS: { key: RegisterTab; label: string }[] = [
  { key: "recent", label: "Recent Materials" },
  { key: "all", label: "All Materials" },
  { key: "out_of_stock", label: "Out of Stock" },
  { key: "low_stock", label: "Low Stock" },
  { key: "category", label: "By Category" },
  { key: "review", label: "Review Issues" },
];

const TAB_EMPTY: Record<RegisterTab, string> = {
  recent: "No recent materials.",
  all: "No matching materials found.",
  out_of_stock: "No out of stock materials.",
  low_stock: "No low stock materials.",
  category: "No categories match.",
  review: "No review issues. Inventory balances and setup look normal.",
};

// What to do about a problem row — plain guidance text, no new action.
const STATUS_HINT: Partial<Record<StockStatus, string>> = {
  negative: "Review issue/receive history",
  out_of_stock: "Create stock request / receive material",
  low_stock: "Reorder soon",
  review_required: "Check this material's units",
};

// Review Issues groups, in the order they are listed.
type ReviewGroup = "negative" | "unit" | "other";

const REVIEW_GROUPS: { key: ReviewGroup; label: string; help: string }[] = [
  {
    key: "negative",
    label: "Negative Stock",
    help: "Negative stock usually means material was issued before enough stock was received, or old test data needs cleanup.",
  },
  {
    key: "unit",
    label: "Unit Setup Issues",
    help: "The unit or purchase-unit setup of these materials looks incomplete or inconsistent.",
  },
  { key: "other", label: "Other Review Required", help: "These rows were marked for review." },
];

function reviewGroupOf(item: BalanceItem): ReviewGroup | null {
  if (!isReviewIssue(item)) return null;
  if (item.stock_status === "negative") return "negative";
  return item.unit_issue !== null ? "unit" : "other";
}

// Newest first: last touched, then last movement, then material name.
function byNewest(a: BalanceItem, b: BalanceItem) {
  return (
    b.last_updated_at.localeCompare(a.last_updated_at) ||
    b.last_movement_date.localeCompare(a.last_movement_date) ||
    a.display_name.localeCompare(b.display_name)
  );
}

const PAGE_SIZES = [25, 50, 100] as const;

type StatusCounts = Record<StockStatus, number>;

function countByStatus(items: BalanceItem[]): StatusCounts {
  const counts: StatusCounts = { ok: 0, low_stock: 0, out_of_stock: 0, negative: 0, review_required: 0 };
  for (const item of items) counts[item.stock_status] += 1;
  return counts;
}

// Compact KPI card for the top strip: icon + title on one line, value
// below, so six cards (seven for a cost viewer) fit in one row at 1366px.
// A clickable card switches the register tab. The larger SummaryCard is
// still used as-is inside Manager Insights.
function CompactStatCard({
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
  decimals?: number;
}) {
  const fg: Record<Tone5, string> = {
    green: "text-[#16A34A]",
    red:   "text-[#ED1C24]",
    blue:  "text-[#2563EB]",
    amber: "text-[#D97706]",
    gray:  "text-[#111827]",
  };
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex min-h-[58px] w-full flex-col justify-center rounded-lg border bg-white px-3 py-2 text-left shadow-sm transition ${
        onClick ? "cursor-pointer hover:border-[#ED1C24]/40 hover:bg-gray-50" : ""
      } ${active ? "border-[#111827] ring-1 ring-[#111827]" : "border-[#E5E7EB]"}`}
    >
      <p className="flex items-start gap-1.5 text-[10px] font-bold uppercase leading-tight tracking-wide text-[#6B7280]">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${fg[tone]}`} aria-hidden />
        <span>{title}</span>
      </p>
      <p className="mt-0.5 text-xl font-black leading-tight text-[#111827]">
        {decimals === 2
          ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
          : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      </p>
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
  recentSince,
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
  // Register tab — always opens on Recent Materials: normal recent
  // activity first, not a problem-only list.
  const [tab, setTab] = useState<RegisterTab>("recent");
  // "OK" has no tab of its own: it is the Balance Status filter applied on
  // top of All Materials (also what the OK Stock card opens).
  const [okOnly, setOkOnly] = useState(false);
  const [quick, setQuick] = useState<QuickFilters>(NO_QUICK_FILTERS);
  const [recentOnly, setRecentOnly] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<ReviewGroup[]>([]);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [pageState, setPageState] = useState({ sig: "", page: 1 });
  const statusFilter: StatusFilter =
    tab === "out_of_stock" || tab === "low_stock"
      ? tab
      : tab === "review"
        ? "review_issues"
        : tab === "all" && okOnly
          ? "ok"
          : "all";
  // Task 9 (Offline Inventory Action Visibility Fix): store the key of the
  // viewed row, not a snapshot of the item — AutoRefresh/RealtimeRefresh
  // re-fetch balanceItems and re-render this component with new objects, so
  // deriving viewItem from the current balanceItems on every render (instead
  // of holding a stale BalanceItem in state) keeps an open Material Details
  // modal's Current Balance in sync with a concurrent Receive/Issue. If the
  // material disappeared entirely, the modal simply closes.
  // ?material=<key> opens that material detail directly — the "Edit units
  // in Inventory" link from a Materials Request row lands here.
  const searchParams = useSearchParams();
  const [viewKey, setViewKey]           = useState<string | null>(() => searchParams.get("material"));
  const viewItem = viewKey ? balanceItems.find((b) => b.key === viewKey) ?? null : null;
  // Manager Insights Reorganization Unit 10G.64A, Task 1 — replaces the
  // 10G.64 collapsed-accordion "Manager Insights" with a top-level tab, so
  // it's visible without scrolling past the table first. Defaults to
  // "register" for every role; a non-cost viewer never gets a way to reach
  // "insights" at all (no tab bar, no preview line — see the JSX below), so
  // this state carries no cost data itself and is harmless either way.
  const [activeTab, setActiveTab] = useState<"register" | "insights">("register");

  const isEmpty = balanceItems.length === 0;
  const hasActiveFilters =
    search.trim() !== "" || category !== null || okOnly || recentOnly ||
    quick.hasPartNo || quick.hasSsCode || quick.noLocation;
  // Unit 10G.64B, Task 7 — whether there is any real priced activity to
  // show in Manager Insights at all; drives the "no priced inventory
  // movements recorded yet" note vs. the normal estimate disclaimer.
  const hasAnyPricedInsights =
    spendingSummary.issuedValueThisWeek !== 0 ||
    spendingSummary.issuedValueThisMonth !== 0 ||
    spendingSummary.issuedValueThisYear !== 0 ||
    spendingSummary.receivedValueThisMonth !== 0;

  // Clears search and filters; the active tab stays where it is.
  function resetFilters() {
    setSearch("");
    setCategory(null);
    setOkOnly(false);
    setQuick(NO_QUICK_FILTERS);
    setRecentOnly(false);
  }

  function selectTab(next: RegisterTab) {
    setTab(next);
    setOkOnly(false);
  }

  // From a summary card: also leaves Manager Insights if it is showing.
  function openRegisterTab(next: RegisterTab) {
    setActiveTab("register");
    selectTab(next);
  }

  function openOkStock() {
    setActiveTab("register");
    setTab("all");
    setOkOnly(true);
  }

  function selectStatusFilter(value: StatusFilter) {
    if (value === "ok") {
      setTab("all");
      setOkOnly(true);
    } else if (value === "review_issues") selectTab("review");
    else selectTab(value);
  }

  // A category card opens All Materials filtered to that category.
  function openCategory(name: string) {
    setCategory(name);
    selectTab("all");
  }

  function toggleGroup(group: ReviewGroup) {
    setCollapsedGroups((current) =>
      current.includes(group) ? current.filter((g) => g !== group) : [...current, group]
    );
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
  // Summary cards always count the whole register, whatever is filtered.
  // Negative stock never counts as "recent" — it lives under Review Issues.
  const overallCounts = useMemo(
    () => ({
      ...countByStatus(balanceItems),
      recent: balanceItems.filter((i) => i.stock_status !== "negative" && i.last_updated_at >= recentSince).length,
      review: balanceItems.filter(isReviewIssue).length,
    }),
    [balanceItems, recentSince]
  );

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

  // Search + category + quick filters, before any tab is applied; the tab
  // badges count from this, so a search shows which tab holds the matches.
  // `matched` leaves the category out — the By Category cards need it.
  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balanceItems.filter((item) => {
      if (quick.hasPartNo && !item.part_number) return false;
      if (quick.hasSsCode && !item.ss_rec_code) return false;
      if (quick.noLocation && item.location) return false;
      if (recentOnly && item.last_updated_at < recentSince) return false;
      if (q) {
        const haystack = `${item.display_name} ${item.part_number ?? ""} ${item.ss_rec_code ?? ""} ${item.category} ${item.location ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [balanceItems, search, quick, recentOnly, recentSince]);

  const baseItems = useMemo(
    () => (category ? matched.filter((item) => item.category === category) : matched),
    [matched, category]
  );

  const categorySummary = useMemo(() => {
    const byCategory = new Map<string, BalanceItem[]>();
    for (const item of matched) {
      const list = byCategory.get(item.category);
      if (list) list.push(item);
      else byCategory.set(item.category, [item]);
    }
    const order = new Map(visibleCategories.map((c, i) => [c, i]));
    return Array.from(byCategory.entries())
      .map(([name, items]) => ({
        name,
        total: items.length,
        counts: countByStatus(items),
        review: items.filter(isReviewIssue).length,
      }))
      .sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  }, [matched, visibleCategories]);

  // Recent Materials: touched since `recentSince`, newest first, never a
  // negative-stock row. If nothing is that recent, the 25 most recently
  // touched materials are shown instead so the default view is never blank.
  const recentView = useMemo(() => {
    const normal = baseItems.filter((item) => item.stock_status !== "negative");
    const recent = normal.filter((item) => item.last_updated_at >= recentSince);
    return recent.length > 0
      ? { items: recent.sort(byNewest), fallback: false }
      : { items: normal.sort(byNewest).slice(0, 25), fallback: normal.length > 0 };
  }, [baseItems, recentSince]);

  // Review Issues, group by group, by material name inside each group.
  const reviewItems = useMemo(
    () =>
      REVIEW_GROUPS.flatMap((g) =>
        baseItems
          .filter((item) => reviewGroupOf(item) === g.key)
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
      ),
    [baseItems]
  );

  const baseCounts = useMemo(() => countByStatus(baseItems), [baseItems]);
  const tabCounts: Record<RegisterTab, number> = {
    recent: recentView.items.length,
    all: baseItems.length,
    out_of_stock: baseCounts.out_of_stock,
    low_stock: baseCounts.low_stock,
    category: categorySummary.length,
    review: reviewItems.length,
  };

  // Rows of the active tab. All Materials shows everything (or only OK
  // rows when that filter is on) in the register's existing order.
  const tabItems =
    tab === "recent"
      ? recentView.items
      : tab === "review"
        ? reviewItems
        : tab === "out_of_stock" || tab === "low_stock"
          ? baseItems.filter((item) => item.stock_status === tab)
          : okOnly
            ? baseItems.filter((item) => item.stock_status === "ok")
            : baseItems;

  // A collapsed Review Issues group keeps its header and hides its rows.
  const visibleRows =
    tab === "review" && collapsedGroups.length
      ? tabItems.filter((item) => !collapsedGroups.includes(reviewGroupOf(item) ?? "other"))
      : tabItems;

  // Any change of view or filter starts again from page 1.
  const pageSig = [tab, okOnly, search, category, quick.hasPartNo, quick.hasSsCode, quick.noLocation, recentOnly, pageSize].join("|");
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const page = Math.min(pageState.sig === pageSig ? pageState.page : 1, totalPages);
  const pageRows = visibleRows.slice((page - 1) * pageSize, page * pageSize);
  const goToPage = (next: number) => setPageState({ sig: pageSig, page: Math.min(Math.max(1, next), totalPages) });

  // Print Report opens the existing print route pre-filtered to this view.
  const printParams = new URLSearchParams();
  if (category) printParams.set("category", category);
  if (statusFilter !== "all") printParams.set("balanceStatus", statusFilter);
  const printHref = `/reports/offline-inventory/print${printParams.size ? `?${printParams.toString()}` : ""}`;

  // Material, Balance, Unit, Stock Status, Minimum Stock, Category, Part
  // No., SS Rec. Code, Location, Last Movement, Action (+ 2 cost columns).
  // Recent Materials leaves Minimum Stock out.
  const showMinimumStock = tab !== "recent";
  const columnCount = canViewCosts ? 13 : 11;

  function renderRow(item: BalanceItem) {
    // Recent Materials stays calm: badge only. Review Issues says what is
    // unusual about the row; the other tabs say what to do about it.
    const hint =
      tab === "recent"
        ? undefined
        : tab === "review" && item.stock_status !== "negative"
          ? item.unit_issue ?? STATUS_HINT.review_required
          : STATUS_HINT[item.stock_status];
    return (
      <tr key={item.key} onClick={() => setViewKey(item.key)} className="cursor-pointer hover:bg-gray-50">
        <td className="min-w-[130px] px-2.5 py-1.5 font-semibold text-[#111827]">{item.display_name}</td>
        <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
          <span
            className={`font-black ${
              item.balance > 0 ? "text-[#111827]" : item.balance < 0 ? "text-[#ED1C24]" : "text-amber-600"
            }`}
          >
            {item.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })}
          </span>
        </td>
        <td className="whitespace-nowrap px-2.5 py-1.5 text-xs text-[#4B5563]">{item.unit}</td>
        {/* Text label always shown, never color-only; the hint under a
            problem badge says what to do about it. */}
        <td className="px-2.5 py-1.5">
          <span className="whitespace-nowrap">
            <StatusBadge label={stockStatusLabel(item.stock_status)} tone={stockStatusTone(item.stock_status)} />
          </span>
          {hint && <p className="mt-0.5 text-[10px] leading-tight text-[#6B7280]">{hint}</p>}
        </td>
        {showMinimumStock && (
          <td className="hidden whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-[#4B5563] lg:table-cell">
            {item.minimum_stock_quantity !== null
              ? `${item.minimum_stock_quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${item.unit}`
              : "—"}
          </td>
        )}
        {canViewCosts && (
          <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-[#4B5563]">
            {item.last_unit_cost !== null ? item.last_unit_cost.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"}
          </td>
        )}
        {canViewCosts && (
          <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs font-semibold text-[#111827]">
            {item.stock_status === "negative"
              ? <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Review required</span>
              : item.stock_value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
          </td>
        )}
        <td className="px-2.5 py-1.5 text-xs text-[#4B5563]">{item.category}</td>
        <td className="px-2.5 py-1.5 text-xs text-[#4B5563]">{item.part_number ?? "—"}</td>
        <td className="hidden px-2.5 py-1.5 text-xs text-[#4B5563] lg:table-cell">{item.ss_rec_code ?? "—"}</td>
        <td className="hidden px-2.5 py-1.5 text-xs text-[#4B5563] lg:table-cell">{item.location ?? "—"}</td>
        <td className="hidden whitespace-nowrap px-2.5 py-1.5 text-xs text-[#4B5563] lg:table-cell">
          {fmtDate(item.last_movement_date)}
        </td>
        {/* View only — Receive/Issue still happen through Daily Activity
            for correct Job Card tracking (Unit 10G.16). */}
        <td className="whitespace-nowrap px-2.5 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setViewKey(item.key)}
            className="inline-flex items-center rounded-md border border-[#E5E7EB] px-2.5 py-1 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]"
          >
            View
          </button>
        </td>
      </tr>
    );
  }

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
                every other report's "Print Report" link added in 10G.69/70.
                Opens pre-filtered to the active tab and category. */}
            <Link href={printHref} className={secondaryBtn}>
              <Printer className="h-4 w-4" aria-hidden />
              Print Report
            </Link>
          </>
        }
      />

      <div className="space-y-3 p-3 lg:p-4">
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

        {/* Compact KPI strip — each count card opens its view. Red is kept
            for Review Issues only (and only when there are any); the
            cost-only Stock Value card is a figure only. */}
        <section className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${canViewCosts ? "lg:grid-cols-7" : "lg:grid-cols-6"}`}>
          <CompactStatCard
            title="Total Materials"
            value={totalMaterialsCount}
            tone="blue"
            icon={Boxes}
            onClick={() => openRegisterTab("all")}
            active={activeTab === "register" && tab === "all" && !okOnly}
          />
          <CompactStatCard
            title="Recently Updated"
            value={overallCounts.recent}
            tone="blue"
            icon={History}
            onClick={() => openRegisterTab("recent")}
            active={activeTab === "register" && tab === "recent"}
          />
          <CompactStatCard
            title="Out of Stock"
            value={overallCounts.out_of_stock}
            tone="gray"
            icon={Package}
            onClick={() => openRegisterTab("out_of_stock")}
            active={activeTab === "register" && tab === "out_of_stock"}
          />
          <CompactStatCard
            title="Low Stock"
            value={overallCounts.low_stock}
            tone="amber"
            icon={TrendingDown}
            onClick={() => openRegisterTab("low_stock")}
            active={activeTab === "register" && tab === "low_stock"}
          />
          <CompactStatCard
            title="OK Stock"
            value={overallCounts.ok}
            tone="green"
            icon={CheckCircle2}
            onClick={openOkStock}
            active={activeTab === "register" && tab === "all" && okOnly}
          />
          <CompactStatCard
            title="Review Issues"
            value={overallCounts.review}
            tone={overallCounts.review > 0 ? "red" : "gray"}
            icon={AlertTriangle}
            onClick={() => openRegisterTab("review")}
            active={activeTab === "register" && tab === "review"}
          />
          {canViewCosts && (
            <CompactStatCard title="Stock Value (KWD)" value={totalStockValue} tone="blue" icon={Wallet} decimals={3} />
          )}
        </section>

        {/* Current balance and movement totals as one small line. */}
        <p className="text-xs text-[#9CA3AF]">
          Current balance <strong className="font-bold text-[#4B5563]">{Math.max(0, balance).toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
          {" · "}Received <strong className="font-bold text-[#4B5563]">{totalReceived.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
          {" · "}Issued <strong className="font-bold text-[#4B5563]">{totalIssued.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
          {" · "}Categories <strong className="font-bold text-[#4B5563]">{categoriesCount}</strong>.
        </p>

        {/* Manager Insights bar — never rendered for a non-cost viewer. Its
            button is also the switch between the Inventory Register and the
            Manager Insights panel (it replaces the separate two-pill tab
            row, which cost a full line above the register). The numbers
            are the same spendingSummary values the panel renders, already
            zeroed server-side for anyone without canViewCosts. */}
        {canViewCosts && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#2563EB] text-white">
                <Wallet className="h-3.5 w-3.5" aria-hidden />
              </div>
              <span className="text-xs font-black text-[#111827]">Manager Insights</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#4B5563]">
                Issued this month
                <strong className="font-bold text-[#111827]">
                  {spendingSummary.issuedValueThisMonth.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KWD
                </strong>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#4B5563]">
                Received this month
                <strong className="font-bold text-[#111827]">
                  {spendingSummary.receivedValueThisMonth.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KWD
                </strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === "insights" ? "register" : "insights")}
              className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-[#ED1C24] hover:underline"
            >
              {activeTab === "insights" ? "Back to Inventory Register" : "View details"}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}

        {/* Inventory Register: tabs, search/filters, then one table (or the
            category cards) for the active tab, with one pagination row. */}
        {activeTab === "register" && (
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div role="tablist" aria-label="Inventory views" className="flex gap-0.5 overflow-x-auto border-b border-[#E5E7EB] px-2">
            {REGISTER_TABS.map((t) => {
              const selected = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(t.key)}
                  className={`inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-xs font-bold transition ${
                    selected
                      ? "border-[#111827] text-[#111827]"
                      : "border-transparent text-[#6B7280] hover:text-[#111827]"
                  }`}
                >
                  {t.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      t.key === "review" && tabCounts.review > 0
                        ? "bg-red-50 text-[#ED1C24]"
                        : selected
                          ? "bg-[#111827] text-white"
                          : "bg-gray-100 text-[#4B5563]"
                    }`}
                  >
                    {tabCounts[t.key]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search and filters stay available even before the first
              material is registered. Balance Status mirrors the tabs —
              choosing a status opens that tab. */}
          <div className="grid gap-2 border-b border-[#E5E7EB] px-3 py-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
            <div className="relative">
              <label htmlFor="sb-search" className="sr-only">Search</label>
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
            <div>
              <label htmlFor="sb-category" className="sr-only">Category</label>
              <select
                id="sb-category"
                value={category ?? ""}
                onChange={(e) => setCategory(e.target.value || null)}
                className={inp}
              >
                <option value="">All categories</option>
                {visibleCategories.map((c) => (
                  <option key={c} value={c}>{c} ({categoryCounts.get(c) ?? 0})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sb-status" className="sr-only">Balance Status</label>
              <select
                id="sb-status"
                value={statusFilter}
                onChange={(e) => selectStatusFilter(e.target.value as StatusFilter)}
                className={inp}
              >
                <option value="all">All balance statuses</option>
                <option value="ok">OK</option>
                <option value="low_stock">Low Stock</option>
                <option value="out_of_stock">Out of Stock</option>
                <option value="review_issues">Review Issues</option>
              </select>
            </div>
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
              className={`inline-flex h-[38px] items-center justify-center gap-1.5 rounded-md px-3 text-sm font-bold transition ${
                hasActiveFilters
                  ? "border border-[#E5E7EB] bg-white text-[#111827] hover:bg-gray-50"
                  : "cursor-not-allowed border border-transparent text-[#C4C9D1]"
              }`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-[#E5E7EB] px-3 py-1.5">
            <span className="text-[11px] font-bold text-[#6B7280]">Quick filters:</span>
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={quick[f.key]}
                onClick={() => setQuick((q) => ({ ...q, [f.key]: !q[f.key] }))}
                className={quickChipClass(quick[f.key])}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={recentOnly}
              onClick={() => setRecentOnly((on) => !on)}
              className={quickChipClass(recentOnly)}
            >
              Recently Updated
            </button>
            {category && (
              <button
                type="button"
                onClick={() => setCategory(null)}
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-[#ED1C24]/40 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-[#ED1C24]"
              >
                <Layers className="h-3 w-3" aria-hidden />
                {category}
                <span aria-hidden>×</span>
                <span className="sr-only">Clear category filter</span>
              </button>
            )}
          </div>

          {/* Results area — no materials registered at all yet, the By
              Category cards, nothing in this view, or the table. */}
          {isEmpty ? (
            <div className="flex flex-col items-center gap-6 px-4 py-16 text-center">
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
          ) : tab === "category" ? (
            categorySummary.length === 0 ? (
              <div className="p-8 text-center">
                <h2 className="text-sm font-black text-[#111827]">{TAB_EMPTY.category}</h2>
                <button type="button" onClick={resetFilters} className="mt-2 text-xs font-bold text-[#ED1C24] hover:underline">
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {categorySummary.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => openCategory(c.name)}
                    className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-left transition hover:border-[#ED1C24]/40 hover:bg-gray-50"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-black text-[#111827]">
                        <Layers className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="shrink-0 text-xs font-bold text-[#4B5563]">
                        {c.total} material{c.total === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1 text-[11px] font-bold">
                      <span className={`rounded px-1.5 py-0.5 ${c.counts.out_of_stock ? "bg-gray-200 text-[#111827]" : "bg-gray-50 text-[#9CA3AF]"}`}>
                        Out of Stock {c.counts.out_of_stock}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 ${c.counts.low_stock ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-[#9CA3AF]"}`}>
                        Low {c.counts.low_stock}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 ${c.review ? "bg-red-50 text-[#ED1C24]" : "bg-gray-50 text-[#9CA3AF]"}`}>
                        Review {c.review}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 ${c.counts.ok ? "bg-green-50 text-green-700" : "bg-gray-50 text-[#9CA3AF]"}`}>
                        OK {c.counts.ok}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : tabItems.length === 0 ? (
            <div className="p-8 text-center">
              <h2 className="text-sm font-black text-[#111827]">
                {hasActiveFilters ? "No matching materials found." : TAB_EMPTY[tab]}
              </h2>
              {hasActiveFilters && (
                <>
                  <p className="mt-1.5 text-sm text-[#4B5563]">Try another material name, part no., or SS Rec. Code.</p>
                  <button type="button" onClick={resetFilters} className="mt-3 text-xs font-bold text-[#ED1C24] hover:underline">
                    Reset filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
            {tab === "review" && (
              <p className="flex items-start gap-1.5 border-b border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5 text-xs text-[#4B5563]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" aria-hidden />
                These items need review because the inventory balance or setup looks unusual.
              </p>
            )}
            {tab === "recent" && recentView.fallback && (
              <p className="border-b border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5 text-xs text-[#6B7280]">
                Nothing was added or updated recently — showing the most recently updated materials.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b-2 border-[#E5E7EB] bg-[#F3F4F6] text-left text-[11px] font-bold uppercase leading-tight tracking-wide text-[#4B5563] [&_th]:[overflow-wrap:normal]!">
                  <tr>
                    <th className="px-2.5 py-2">Material</th>
                    <th className="whitespace-nowrap px-2.5 py-2 text-right">Balance</th>
                    <th className="whitespace-nowrap px-2.5 py-2">Unit</th>
                    <th className="px-2.5 py-2">Stock Status</th>
                    {showMinimumStock && <th className="hidden px-2.5 py-2 text-right lg:table-cell">Minimum Stock</th>}
                    {canViewCosts && <th className="px-2.5 py-2 text-right">Unit Cost</th>}
                    {canViewCosts && <th className="px-2.5 py-2 text-right">Stock Value</th>}
                    <th className="px-2.5 py-2">Category</th>
                    <th className="px-2.5 py-2">Part No.</th>
                    <th className="hidden px-2.5 py-2 lg:table-cell">SS Rec. Code</th>
                    <th className="hidden px-2.5 py-2 lg:table-cell">Location / Bin</th>
                    <th className="hidden px-2.5 py-2 lg:table-cell">Last Movement</th>
                    <th className="px-2.5 py-2 text-right">Action</th>
                  </tr>
                </thead>
                {tab === "review" ? (
                  // One body per group: a header row (click to collapse)
                  // that says why the group is here, then its rows on this
                  // page.
                  REVIEW_GROUPS.map((group) => {
                    const groupTotal = reviewItems.filter((item) => reviewGroupOf(item) === group.key).length;
                    if (groupTotal === 0) return null;
                    const collapsed = collapsedGroups.includes(group.key);
                    const rows = pageRows.filter((item) => reviewGroupOf(item) === group.key);
                    if (!collapsed && rows.length === 0) return null;
                    return (
                      <tbody key={group.key} className="divide-y divide-[#F3F4F6]">
                        <tr className="bg-[#F9FAFB]">
                          <td colSpan={columnCount} className="px-2.5 py-1.5">
                            <button
                              type="button"
                              aria-expanded={!collapsed}
                              onClick={() => toggleGroup(group.key)}
                              className="flex w-full items-start gap-2 text-left"
                            >
                              {collapsed ? (
                                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B7280]" aria-hidden />
                              ) : (
                                <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B7280]" aria-hidden />
                              )}
                              <span className="whitespace-nowrap text-xs font-black text-[#111827]">
                                {group.label} ({groupTotal})
                              </span>
                              <span className="text-[11px] text-[#6B7280]">{group.help}</span>
                            </button>
                          </td>
                        </tr>
                        {!collapsed && rows.map(renderRow)}
                      </tbody>
                    );
                  })
                ) : (
                  <tbody className="divide-y divide-[#F3F4F6]">{pageRows.map(renderRow)}</tbody>
                )}
              </table>
            </div>
            </>
          )}

          {/* One pagination row for the active tab's table. */}
          {!isEmpty && tab !== "category" && tabItems.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] px-3 py-1.5">
              <span className="text-xs font-semibold text-[#4B5563]">
                Showing {visibleRows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, visibleRows.length)} of {visibleRows.length}
              </span>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#4B5563]">
                <label htmlFor="sb-page-size" className="font-semibold">Rows</label>
                <select
                  id="sb-page-size"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-md border border-[#E5E7EB] bg-white px-1.5 py-1 text-xs"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1} className={pagerBtn}>
                  Previous
                </button>
                <span>Page {page} of {totalPages}</span>
                <button type="button" onClick={() => goToPage(page + 1)} disabled={page >= totalPages} className={pagerBtn}>
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
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
        <MaterialDetailModal item={viewItem} onClose={() => setViewKey(null)} canViewCosts={canViewCosts} canManage={canManage} />
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
