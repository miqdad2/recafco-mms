"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { DATE_RANGE_PRESETS, DATE_RANGE_PRESET_LABELS, type DateRangePreset } from "@/lib/reports/date-range";

// Printable Division-Based Reports Foundation Unit 10G.69, Task 2/3.
//
// Screen-only common filter bar (Date Range preset + From/To + Division),
// shared by all three print report pages this unit adds. A plain GET
// <form> — no server action needed, submitting just navigates to the same
// URL with new query params, which the report page re-reads on the next
// render (the same convention every other filter form in this app already
// uses, e.g. the Assets/Inventory pages). The only reason this needs to be
// a client component at all is the small From/To show/hide behavior when
// switching to/from "Custom" — everything else is plain, uncontrolled form
// fields.
//
// Report-specific extra fields (Status, Asset Type, Asset, Material,
// Category, Balance Status, Worker Type, Worker) are passed in as
// `children` and rendered inside this same <form>, so "Apply Filters"
// submits all of them together in one request.
//
// Unit 10G.70, Task 3 — `showDateRange`/`divisions` are optional (default
// true / omitted): the Inventory Control report has no meaningful "Date
// Range" (its balances are a current-state snapshot, not a movement-date-
// filtered read — the task itself calls this filter "if applicable") and
// no "Division" concept at all, so it renders this same shared bar with
// both switched off rather than showing controls that wouldn't actually
// change anything — extending the one shared filter bar to fit a report
// that doesn't need every field, instead of forking a second one.

export function ReportPrintFilterBar({
  range,
  from,
  to,
  division,
  divisions,
  showDateRange = true,
  children,
}: {
  range: DateRangePreset;
  from: string;
  to: string;
  division?: string;
  divisions?: readonly string[];
  showDateRange?: boolean;
  children?: React.ReactNode;
}) {
  const [selectedRange, setSelectedRange] = useState<DateRangePreset>(range);
  const isCustom = selectedRange === "custom";

  return (
    <form className="no-print mb-4 grid gap-3 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      {showDateRange && (
        <>
          <div>
            <label htmlFor="rpf-range" className="mb-1 block text-xs font-bold text-[#4B5563]">Date Range</label>
            <select
              id="rpf-range"
              name="range"
              value={selectedRange}
              onChange={(e) => setSelectedRange(e.target.value as DateRangePreset)}
              className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
            >
              {DATE_RANGE_PRESETS.map((p) => (
                <option key={p} value={p}>{DATE_RANGE_PRESET_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rpf-from" className="mb-1 block text-xs font-bold text-[#4B5563]">From Date</label>
            <input
              id="rpf-from"
              type="date"
              name="from"
              defaultValue={from}
              disabled={!isCustom}
              className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-[#9CA3AF]"
            />
          </div>
          <div>
            <label htmlFor="rpf-to" className="mb-1 block text-xs font-bold text-[#4B5563]">To Date</label>
            <input
              id="rpf-to"
              type="date"
              name="to"
              defaultValue={to}
              disabled={!isCustom}
              className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-[#9CA3AF]"
            />
          </div>
        </>
      )}
      {divisions && divisions.length > 0 && (
        <div>
          <label htmlFor="rpf-division" className="mb-1 block text-xs font-bold text-[#4B5563]">Division</label>
          <select
            id="rpf-division"
            name="division"
            defaultValue={division}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
          >
            <option value="">All Divisions</option>
            {divisions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {children}

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <button
          type="submit"
          className="inline-flex h-[38px] items-center rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white transition hover:bg-red-700"
        >
          Apply Filters
        </button>
        <a
          href="?"
          className="inline-flex h-[38px] items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset
        </a>
      </div>
    </form>
  );
}
