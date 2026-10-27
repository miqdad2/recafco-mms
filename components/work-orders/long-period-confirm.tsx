"use client";

import { AlertTriangle } from "lucide-react";

import { formatDurationMinutes } from "@/lib/format/kuwait-time";
import { LONG_PERIOD_REVIEW_MINUTES } from "@/lib/work-orders/work-time-correction-rules";

// Final Integration Review — shown under any hand-entered work period
// (Data Entry correction, Manager Edit / Correct, Manager manual entry) when
// it is unusually long. Nothing is refused for its length alone; the person
// entering it confirms it, and the server requires the same tick
// (`confirm_long_period`), so a wrong-day slip is not saved silently.
export function LongPeriodConfirm({
  id,
  minutes,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  minutes: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900" role="alert">
      <p className="flex items-start gap-1.5 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        This work period is {formatDurationMinutes(minutes)} long — more than {LONG_PERIOD_REVIEW_MINUTES / 60} hours. Check the start and end dates.
      </p>
      <label htmlFor={id} className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 font-bold">
        <input
          id={id}
          type="checkbox"
          name="confirm_long_period"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="h-5 w-5 accent-[#ED1C24]"
        />
        This long period is correct
      </label>
    </div>
  );
}
