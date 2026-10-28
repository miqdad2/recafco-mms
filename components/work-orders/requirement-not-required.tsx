"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import { confirmRequirementNotRequiredAction } from "@/app/actions/job-card-requirements";
import { dispatchActionToast } from "@/lib/action-messages";
import { formatKuwaitDateTime } from "@/lib/format/kuwait-time";
import type { RequirementConfirmation } from "@/lib/work-orders/closure-readiness";

// "Not Required" for a Job Card with no workers / no materials. Workers need
// a short reason; materials a plain confirmation. The server
// (lib/backend/work-orders/closure-requirements.ts) re-checks role,
// visibility, status and that nothing was added in the meantime.

type Requirement = "workers" | "materials";

const COPY: Record<Requirement, { title: string; prompt: string }> = {
  workers: {
    title: "No Workers Required",
    prompt: "Why is no worker needed for this Job Card?",
  },
  materials: {
    title: "No Materials Required",
    prompt: "Confirm that this Job Card does not need any materials.",
  },
};

export function NotRequiredButton({
  workOrderId,
  requirement,
  className,
}: {
  workOrderId: string;
  requirement: Requirement;
  className: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const copy = COPY[requirement];
  const reasonTooShort = requirement === "workers" && reason.trim().length < 3;

  function submit() {
    setError(null);
    const form = new FormData();
    form.set("work_order_id", workOrderId);
    form.set("requirement", requirement);
    form.set("reason", reason.trim());
    startTransition(async () => {
      const result = await confirmRequirementNotRequiredAction(null, form);
      if (!result?.ok) {
        setError(result?.error ?? "Could not save. Please try again.");
        return;
      }
      dispatchActionToast({ tone: "success", title: result.message });
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Not Required
      </button>
    );
  }

  return (
    <div className="mt-1.5 w-full rounded-md border border-[#E5E7EB] bg-white p-2.5" role="group" aria-label={copy.title}>
      <p className="text-xs font-bold text-[#111827]">{copy.title}</p>
      {requirement === "workers" ? (
        <label className="mt-1 block text-xs text-[#4B5563]">
          {copy.prompt}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={2}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-sm text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
            placeholder="e.g. Inspection only, done by the vendor"
          />
        </label>
      ) : (
        <p className="mt-1 text-xs text-[#4B5563]">{copy.prompt}</p>
      )}
      {error ? <p className="mt-1 text-xs font-semibold text-[#B91C1C]">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isPending || reasonTooShort}
          className="inline-flex min-h-8 items-center gap-1 rounded-md bg-[#2b2b2b] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Confirm
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={isPending}
          className="inline-flex min-h-8 items-center rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** "No Workers Required — confirmed by Ali on 28 Oct 2026, 2:05 PM. Reason: …" */
export function NotRequiredNote({ label, confirmation }: { label: string; confirmation: RequirementConfirmation }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs text-green-900">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-700" aria-hidden="true" />
      <span>
        <strong>{label}</strong> — confirmed by {confirmation.confirmedByName ?? "a user"} on {formatKuwaitDateTime(confirmation.confirmedAt)}
        {confirmation.reason ? `. Reason: ${confirmation.reason}` : "."}
      </span>
    </p>
  );
}
