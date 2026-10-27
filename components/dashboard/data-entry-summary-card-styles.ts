// Data Entry Dashboard Visual Refinement: one set of classes for all six
// Data Entry Today Summary cards — four render via the dashboard page's
// TodaySummaryCard (size="lg"), two are their own modal-opening buttons
// (WaitingManagerApprovalCard, DataEntryClosedRecentlyCard) — so every card
// has the same height, padding, radius, border, shadow and number/label
// hierarchy regardless of which component renders it. Presentation only.
//
// Layout: number + icon on the top row, label on its own full-width line
// below (two lines allowed, never clipped mid-word), optional detail under it.
//
// min-h is `!important` because app/globals.css's unlayered mobile rule
// `button { min-height: 44px }` otherwise beats this utility on the two
// <button> cards below 640px and they render shorter than the four links.

export const deSummaryCardClass =
  "group flex h-full min-h-[112px]! w-full flex-col justify-between gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-3.5 text-left " +
  "shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-[border-color,box-shadow] duration-150 " +
  "hover:border-[#CBD2DC] hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24] focus-visible:ring-offset-2 motion-reduce:transition-none";

export const deSummaryTopRowClass = "flex items-start justify-between gap-2";

export const deSummaryValueClass = "text-[28px] font-black leading-9 tabular-nums tracking-tight text-[#111827]";

export const deSummaryIconClass = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white";

export const deSummaryLabelClass = "block line-clamp-2 text-[13px] font-semibold leading-snug text-[#374151]";

export const deSummaryDetailClass = "mt-0.5 block truncate text-[11px] leading-tight text-[#6B7280]";
