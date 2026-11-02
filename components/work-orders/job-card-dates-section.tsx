import { CalendarClock } from "lucide-react";

import { formatKuwaitDate, formatKuwaitDateTime } from "@/lib/format/kuwait-time";
import { JOB_CARD_DATE_SOURCE_NOTE, type JobCardDate, type JobCardDates } from "@/lib/work-orders/job-card-dates";
import type { JobCardTiming } from "@/lib/work-orders/job-card-timing";

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

function TimingRow({ label, value, muted }: { label: string; value: string; muted: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">{label}</dt>
      <dd className={`mt-0.5 text-sm font-bold ${muted ? "text-[#9CA3AF]" : "text-[#111827]"}`}>{value}</dd>
    </div>
  );
}

export function JobCardDatesSection({ dates, timing }: { dates: JobCardDates; timing: JobCardTiming }) {
  return (
    <section className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm" aria-labelledby="job-card-dates-heading">
      <p id="job-card-dates-heading" className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-[#ED1C24]">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Job Card Time Details
      </p>
      <dl className="mt-3 space-y-3">
        <DateRow label="Created Date & Time" value={dates.created} />
        <TimingRow label="Job Card Opened" value={timing.openedText} muted={timing.opened.state !== "exact"} />
        <DateRow label="Work Started" value={dates.workStart} />
        <TimingRow label="Work Completed" value={timing.completedText} muted={timing.completed.state !== "exact"} />
        <TimingRow label="Job Card Duration" value={timing.durationText} muted={timing.duration.state !== "value"} />
        {timing.managerApprovedText ? <TimingRow label="Manager Approved On" value={timing.managerApprovedText} muted={false} /> : null}
      </dl>
      {timing.problem ? <p role="alert" className="mt-3 text-xs font-semibold text-[#B91C1C]">{timing.problem}</p> : null}
      <p className="mt-3 text-[11px] text-[#9CA3AF]">Kuwait time</p>
    </section>
  );
}
