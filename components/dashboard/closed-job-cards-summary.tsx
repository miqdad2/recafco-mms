"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Printer, Search } from "lucide-react";

import {
  getClosedJobCardsListAction,
  getClosedJobCardDetailAction,
  type ClosedJobCardsFilter,
  type ClosedJobCardListRow,
  type ClosedJobCardDetail,
} from "@/app/actions/closed-job-cards";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { computeHoursVariance, hoursVarianceTone } from "@/lib/work-orders/hours-variance";

// Manager Closed Job Cards Summary and Global Navigation Improvements Unit
// 10E, Part A.
//
// Pattern B throughout (same as WorkerActivityDetailModal/Unit 10C and the
// Daily Activity materials modal/Unit 10D): the KPI tile's week/month counts
// are the only thing computed unconditionally on every dashboard load (two
// cheap counts, added to the existing mgData query batch in page.tsx); the
// list and per-Job-Card detail below are fetched only when the Manager
// actually opens them, via app/actions/closed-job-cards.ts.

// ── KPI tile ─────────────────────────────────────────────────────────────

export function ClosedJobCardsSummaryCard({ weekCount, monthCount }: { weekCount: number; monthCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Manager Dashboard Today Summary Card Size Polish Unit 10E.1: sized
          to match TodaySummaryCard's size="md" frame exactly (same padding/
          icon box) so this tile doesn't look smaller than its row
          neighbors; value text stays at text-sm (not text-xl like a plain
          number card) since "Week: N · Month: N" is a longer string that
          would wrap/overflow a narrow xl:9-col cell at the larger size. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 rounded-md border border-[#E5E7EB] bg-white px-3.5 py-3 text-left transition hover:border-[#2563EB] hover:shadow-sm"
      >
        <span className="inline-flex shrink-0 rounded-md bg-[#16A34A] p-2 text-white">
          <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] font-black uppercase leading-tight text-[#6B7280] line-clamp-2">Closed Jobs</span>
          <span className="block truncate text-sm font-black leading-tight text-[#111827]">
            Week: {weekCount} · Month: {monthCount}
          </span>
        </span>
      </button>
      {open ? <ClosedJobCardsModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// Data Entry Dashboard Closure and Closed Jobs Clarity Unit 10G.9, Task 3:
// Data Entry's own "Closed Recently" tile — same click-to-open-a-popup
// mechanism as ClosedJobCardsSummaryCard above (Task 9's "does not leave
// dashboard"), but styled to match the plain TodaySummaryCard tiles the rest
// of Data Entry's Today Summary row uses (single count + one-line subtitle),
// not Manager's own two-number KPI tile style — and opens the SAME
// ClosedJobCardsModal (Task 8 — reused, not duplicated) with
// defaultPeriod="last14days" and the Data Entry period set. No cost/pay is
// shown here for the same reason as everywhere else in this modal:
// canViewCosts (resolved server-side in the action) is false for Data Entry.
export function DataEntryClosedRecentlyCard({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2.5 text-left transition hover:border-[#2563EB] hover:shadow-sm"
      >
        <span className="inline-flex shrink-0 rounded-md bg-[#16A34A] p-2 text-white">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          {/* Data Entry Today Summary Label Clarity Unit 10G.12, Task 3:
              "Closed Recently" -> "Closed" — label only, same count/logic,
              same "Closed in last 14 days" subtitle right below. */}
          <span className="block truncate text-[10px] font-black uppercase leading-tight text-[#6B7280]">Closed</span>
          <span className="block text-lg font-black leading-tight text-[#111827]">{count}</span>
          <span className="block truncate text-[10px] text-[#9CA3AF]">Closed in last 14 days</span>
        </span>
      </button>
      {open ? (
        <ClosedJobCardsModal
          onClose={() => setOpen(false)}
          defaultPeriod="last14days"
          periods={DATA_ENTRY_PERIODS}
          subtitle="Closed Job Cards you can review — no cost or pay shown."
        />
      ) : null}
    </>
  );
}

// ── List modal ───────────────────────────────────────────────────────────

const MANAGER_PERIODS: { value: ClosedJobCardsFilter["period"]; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

// Data Entry Dashboard Closure and Closed Jobs Clarity Unit 10G.9, Task 3:
// Data Entry's own period set — "Last 14 Days" (its dashboard tile's own
// window) replaces "This Week", "This Month" and "Custom" both kept exactly
// as Task 3 asks ("Custom range if existing Closed Jobs modal supports it" —
// it already does). Manager's MANAGER_PERIODS above is untouched.
const DATA_ENTRY_PERIODS: { value: ClosedJobCardsFilter["period"]; label: string }[] = [
  { value: "last14days", label: "Last 14 Days" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

function ListRow({ row, onViewDetails }: { row: ClosedJobCardListRow; onViewDetails: () => void }) {
  return (
    <div className="flex flex-col gap-2 border-b border-[#EEF2F6] py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-[#111827]">
          {row.workOrderNumber ?? "Job Card"}
          {row.assetLabel ? <span className="font-normal text-[#6B7280]"> — {row.assetLabel}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-[#6B7280]">{row.issue}</p>
        <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
          Closed {row.closedAtLabel}
          {row.closedByName ? ` by ${row.closedByName}` : ""} · {row.workersCount} worker{row.workersCount !== 1 ? "s" : ""} · {row.totalHours}h
          {/* Estimated Work Hours for Job Cards and Workers Unit 10G.13,
              Task 9: a brief "Est: Xh" in the compact row — the full
              Estimated/Actual/Variance comparison lives in the detail
              popup below (View Details). */}
          {row.estimatedHours !== null ? ` (Est: ${row.estimatedHours}h)` : ""}
          {row.totalAmount !== null ? ` · ${row.totalAmount.toFixed(3)} KWD` : ""} · {row.materialsSummary}
        </p>
      </div>
      <div className="shrink-0">
        <button
          type="button"
          onClick={onViewDetails}
          className="inline-flex min-h-8 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-3 text-xs font-bold text-[#111827] transition hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          View Details
        </button>
      </div>
    </div>
  );
}

function ClosedJobCardsModal({
  onClose,
  defaultPeriod = "week",
  periods = MANAGER_PERIODS,
  subtitle = "Review completed work, labor hours, and materials.",
}: {
  onClose: () => void;
  // Task 3/8 — additive, optional: Manager's existing call site
  // (ClosedJobCardsSummaryCard below) passes neither, so its behavior is
  // byte-for-byte unchanged (still defaults to "week"/MANAGER_PERIODS).
  // DataEntryClosedRecentlyCard passes "last14days"/DATA_ENTRY_PERIODS.
  defaultPeriod?: ClosedJobCardsFilter["period"];
  periods?: { value: ClosedJobCardsFilter["period"]; label: string }[];
  subtitle?: string;
}) {
  const [period, setPeriod] = useState<ClosedJobCardsFilter["period"]>(defaultPeriod);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState<ClosedJobCardListRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // "Is the currently-displayed `rows` for the filter combo we're showing
  // right now" — derived at render instead of reset synchronously inside
  // the fetch effect (avoids the react-hooks/set-state-in-effect
  // cascading-render warning; also means the previous filter's list stays
  // visible until the new one resolves, instead of flashing to "Loading…").
  const filterKey = JSON.stringify({ period, from: period === "custom" ? from : null, to: period === "custom" ? to : null, debouncedSearch });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const isLoading = loadedKey !== filterKey && !loadError;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    getClosedJobCardsListAction({ period, from: period === "custom" ? from : undefined, to: period === "custom" ? to : undefined, search: debouncedSearch })
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setLoadError(false);
        setLoadedKey(filterKey);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoadedKey(filterKey);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, from, to, debouncedSearch]);

  // Task 4/7 — "View Details" swaps this list out for the detail view
  // (same z-40/z-50 shell, mutually exclusive rather than stacked — the
  // established SessionHistoryModal/WorkerActivityDetailModal pattern).
  // "Back" returns here without re-closing the whole popup.
  if (selectedId) {
    return <ClosedJobCardDetailModal workOrderId={selectedId} onBack={() => setSelectedId(null)} onClose={onClose} />;
  }

  return (
    <LargeFormModal title="Closed Job Cards" subtitle={subtitle} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2">
        {periods.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriod(p.value)}
            className={`inline-flex min-h-8 items-center justify-center rounded-full border px-3 text-xs font-bold transition ${
              period === p.value ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#2563EB] hover:text-[#2563EB]"
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Job Card, asset, plate, worker…"
            className="focus-ring w-full rounded-md border border-[#E5E7EB] py-1.5 pl-8 pr-2 text-xs"
          />
        </div>
      </div>

      {period === "custom" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold text-[#4B5563]">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="focus-ring ml-1.5 rounded-md border border-[#E5E7EB] px-2 py-1 text-xs" />
          </label>
          <label className="text-xs font-bold text-[#4B5563]">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="focus-ring ml-1.5 rounded-md border border-[#E5E7EB] px-2 py-1 text-xs" />
          </label>
        </div>
      ) : null}

      <div className="mt-3">
        {loadError ? (
          <p className="py-10 text-center text-sm text-[#6B7280]">Could not load closed Job Cards.</p>
        ) : isLoading || rows === null ? (
          <p className="py-10 text-center text-sm text-[#6B7280]">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-10 text-center">
            <p className="text-sm font-semibold text-[#111827]">No Job Cards closed in this period.</p>
          </div>
        ) : (
          <div>
            {rows.map((row) => (
              <ListRow key={row.id} row={row} onViewDetails={() => setSelectedId(row.id)} />
            ))}
          </div>
        )}
      </div>
    </LargeFormModal>
  );
}

// ── Detail view ──────────────────────────────────────────────────────────

function DetailFooter({ workOrderId, onBack, onClose }: { workOrderId: string; onBack: () => void; onClose: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#EEF2F6] pt-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-9 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-3 text-xs font-bold text-[#111827] transition hover:bg-gray-50">
        Back to List
      </button>
      <Link
        href={`/maintenance/work-orders/${workOrderId}`}
        className="inline-flex min-h-9 items-center justify-center rounded-md bg-[#ED1C24] px-3 text-xs font-bold text-white transition hover:bg-[#c8181e]"
      >
        Open Full Job Card
      </Link>
      <Link
        href={`/maintenance/work-orders/${workOrderId}/print`}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
      >
        <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
      </Link>
      <button
        type="button"
        onClick={onClose}
        className="ml-auto inline-flex min-h-9 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-3 text-xs font-bold text-[#4B5563] transition hover:bg-gray-50"
      >
        Close
      </button>
    </div>
  );
}

function materialStatusTone(status: ClosedJobCardDetail["materials"][number]["status"]): "green" | "amber" | "red" {
  if (status === "Fully Issued") return "green";
  if (status === "Partially Issued") return "amber";
  return "red";
}

function ClosedJobCardDetailModal({ workOrderId, onBack, onClose }: { workOrderId: string; onBack: () => void; onClose: () => void }) {
  const [detail, setDetail] = useState<ClosedJobCardDetail | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getClosedJobCardDetailAction(workOrderId)
      .then((result) => {
        if (cancelled) return;
        if (!result) setLoadError(true);
        else setDetail(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  return (
    // Back (X/backdrop) returns to the list — closing the WHOLE popup is the
    // explicit footer "Close" button below, matching Task 4's action list.
    <LargeFormModal title="Closed Job Card Details" onClose={onBack}>
      {loadError ? (
        <p className="py-10 text-center text-sm text-[#6B7280]">This Job Card could not be loaded.</p>
      ) : !detail ? (
        <p className="py-10 text-center text-sm text-[#6B7280]">Loading…</p>
      ) : (
        <>
          {/* Job Card summary */}
          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
            <p className="text-base font-black text-[#111827]">
              {detail.workOrderNumber ?? "Job Card"}
              {detail.assetLabel ? <span className="font-normal text-[#6B7280]"> — {detail.assetLabel}</span> : null}
            </p>
            <p className="mt-1 text-sm text-[#374151]">{detail.issue}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B7280]">
              <span>Created: <strong className="text-[#111827]">{detail.createdAtLabel}</strong></span>
              <span>Closed: <strong className="text-[#111827]">{detail.closedAtLabel}</strong></span>
              {detail.requestedByName ? <span>Requested by: <strong className="text-[#111827]">{detail.requestedByName}</strong></span> : null}
              {detail.closedByName ? <span>Closed by: <strong className="text-[#111827]">{detail.closedByName}</strong></span> : null}
            </div>
          </div>

          {/* Manager Closure Review Estimated vs Actual Labor Transparency
              Unit 10G.21, Task 12: same Job-Card-level Estimated/Actual/
              Variance display reused from the Closure Review modal — Actual
              Hours now always renders even with no estimate ("Not
              recorded"/"Not available" fallbacks plus a gray "No Estimate"
              badge), replacing Unit 10G.13's "hide entirely" behavior, for
              consistency with the Closure Review popup this Job Card went
              through before it was closed. */}
          <div className="mt-4 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-2.5">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Estimated vs Actual</p>
            {(() => {
              const variance = computeHoursVariance(detail.estimatedHours, detail.totalHours);
              return (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#4B5563]">
                  <span>Estimated: <strong className="text-[#111827]">{detail.estimatedHours !== null ? `${detail.estimatedHours} h` : "Not recorded"}</strong></span>
                  <span>Actual: <strong className="text-[#111827]">{detail.totalHours} h</strong></span>
                  {variance.varianceHours !== null && (
                    <span>Variance: <strong className="text-[#111827]">{variance.varianceHours >= 0 ? "+" : ""}{variance.varianceHours} h</strong></span>
                  )}
                  <StatusBadge label={variance.label} tone={hoursVarianceTone(variance.status)} />
                </div>
              );
            })()}
          </div>

          {/* Workers */}
          <div className="mt-4">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">
              Workers ({detail.workers.length}) — Total {detail.totalHours}h{detail.totalAmount !== null ? ` · ${detail.totalAmount.toFixed(3)} KWD` : ""}
            </p>
            {detail.workers.length === 0 ? (
              <p className="mt-1.5 text-xs text-[#9CA3AF]">No workers recorded on this Job Card.</p>
            ) : (
              <div className="mt-1.5 divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#E5E7EB]">
                {detail.workers.map((w, i) => {
                  // Unit 10G.21, Task 12 — per-worker estimate/variance,
                  // unconditional on canViewCosts (only hourlyRate/totalPay
                  // below stay gated); always computed now (was
                  // conditional on w.estimatedHours !== null in Unit
                  // 10G.13) so a no-estimate worker still shows "Est: Not
                  // recorded" with a gray "No Estimate" badge instead of no
                  // line at all.
                  const workerVariance = computeHoursVariance(w.estimatedHours, w.hours);
                  return (
                    <div key={`${w.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#111827]">{w.name}</p>
                        <p className="text-[11px] text-[#6B7280]">{w.role}</p>
                      </div>
                      <div className="text-right text-[#4B5563]">
                        <p>{w.hours}h</p>
                        {w.hourlyRate !== null ? <p className="text-[11px] text-[#9CA3AF]">{w.hourlyRate.toFixed(3)} KWD/hr{w.totalPay !== null ? ` · ${w.totalPay.toFixed(3)} KWD` : ""}</p> : null}
                        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#9CA3AF]">
                          Est: {w.estimatedHours !== null ? `${w.estimatedHours}h` : "Not recorded"}
                          {workerVariance.varianceHours !== null && ` (${workerVariance.varianceHours >= 0 ? "+" : ""}${workerVariance.varianceHours}h)`}
                          <StatusBadge label={workerVariance.label} tone={hoursVarianceTone(workerVariance.status)} />
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Materials */}
          <div className="mt-4">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Materials ({detail.materials.length})</p>
            {detail.materials.length === 0 ? (
              <p className="mt-1.5 text-xs text-[#9CA3AF]">No required materials on this Job Card.</p>
            ) : (
              <div className="mt-1.5 divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#E5E7EB]">
                {detail.materials.map((m, i) => (
                  <div key={`${m.description}-${i}`} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs">
                    <p className="min-w-0 truncate font-semibold text-[#111827]">{m.description}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[#4B5563]">
                        {m.issuedQty}/{m.requiredQty} {m.unit}
                      </span>
                      <StatusBadge label={m.status} tone={materialStatusTone(m.status)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DetailFooter workOrderId={detail.id} onBack={onBack} onClose={onClose} />
        </>
      )}
    </LargeFormModal>
  );
}
