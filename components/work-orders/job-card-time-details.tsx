import { AlertCircle } from "lucide-react";

import { WORKER_HOURS_EXPLANATION, type JobCardTiming } from "@/lib/work-orders/job-card-timing";

// The same two blocks on Daily Activity, Closure Review and Closed Job Cards,
// so Job Card Duration (elapsed time) is never read as Worker Hours (combined
// time). Values come from lib/work-orders/job-card-timing.ts.

function TimeValue({ label, value, muted }: { label: string; value: string; muted: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm font-bold ${muted ? "text-[#6B7280]" : "text-[#111827]"}`}>{value}</dd>
    </div>
  );
}

export function JobCardTimeDetails({ timing }: { timing: JobCardTiming }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5" aria-label="Job Card Time Details (Kuwait time)">
      <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Job Card Time Details</p>
      <dl className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <TimeValue label="Job Card Opened" value={timing.openedText} muted={timing.opened.state !== "exact"} />
        <TimeValue label="Work Completed" value={timing.completedText} muted={timing.completed.state !== "exact"} />
        <TimeValue label="Job Card Duration" value={timing.durationText} muted={timing.duration.state !== "value"} />
        {timing.managerApprovedText ? <TimeValue label="Manager Approved On" value={timing.managerApprovedText} muted={false} /> : null}
      </dl>
      {timing.problem ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-[#B91C1C]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {timing.problem}
        </p>
      ) : null}
    </section>
  );
}

export function WorkerHoursSummary({ estimatedHours, actualHours }: { estimatedHours: number | null; actualHours: number }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2.5" aria-label="Workers' Working Hours">
      <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Workers&apos; Working Hours</p>
      <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="text-[#4B5563]">Estimated Worker Hours:</dt>
          <dd className="font-bold text-[#111827]">{estimatedHours !== null ? `${estimatedHours} h` : "Not recorded"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-1.5">
          <dt className="text-[#4B5563]">Actual Worker Hours:</dt>
          <dd className="font-bold text-[#111827]">{actualHours} h</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-[#6B7280]">{WORKER_HOURS_EXPLANATION}</p>
    </section>
  );
}
