import { CalendarClock } from "lucide-react";

import { formatKuwaitDate, formatKuwaitDateTime } from "@/lib/format/kuwait-time";
import { JOB_CARD_DATE_SOURCE_NOTE, type JobCardDate, type JobCardDates } from "@/lib/work-orders/job-card-dates";

// Job Card Dates — a compact block in the Overview tab's Quick Facts column.
// Values come from lib/work-orders/job-card-dates-data.ts (the same source
// the printed Job Card uses). All times are Kuwait time.

export function jobCardDateText(value: JobCardDate): string {
  if (!value.recorded) return value.label;
  return value.dateOnly ? formatKuwaitDate(value.at) : formatKuwaitDateTime(value.at);
}

function DateRow({ label, value }: { label: string; value: JobCardDate }) {
  const note = value.recorded ? JOB_CARD_DATE_SOURCE_NOTE[value.source] : null;
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">{label}</dt>
      <dd className={`mt-0.5 text-sm font-bold ${value.recorded ? "text-[#111827]" : "text-[#9CA3AF]"}`}>
        {jobCardDateText(value)}
      </dd>
      {note && value.recorded && value.source === "form" ? <dd className="text-[11px] text-[#9CA3AF]">{note}</dd> : null}
    </div>
  );
}

// `compact` (Daily Activity selected panel): the same rows side by side in
// a slim card; the detail page keeps the default stacked block.
export function JobCardDatesSection({ dates, compact = false }: { dates: JobCardDates; compact?: boolean }) {
  if (compact) {
    return (
      <section className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5" aria-label="Job Card Dates (Kuwait time)">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <DateRow label="Created" value={dates.created} />
          <DateRow label="Work Start" value={dates.workStart} />
          <DateRow label="Work End" value={dates.workEnd} />
        </dl>
      </section>
    );
  }
  return (
    <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm" aria-labelledby="job-card-dates-heading">
      <p id="job-card-dates-heading" className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-[#ED1C24]">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Job Card Dates
      </p>
      <dl className="mt-3 space-y-3">
        <DateRow label="Created Date & Time" value={dates.created} />
        <DateRow label="Work Start Date & Time" value={dates.workStart} />
        <DateRow label="Work End Date & Time" value={dates.workEnd} />
        {dates.closed ? <DateRow label="Closed (Manager approved)" value={dates.closed} /> : null}
      </dl>
      <p className="mt-3 text-[11px] text-[#9CA3AF]">Kuwait time</p>
    </section>
  );
}
