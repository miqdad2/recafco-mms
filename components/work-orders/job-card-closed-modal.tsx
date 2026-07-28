"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";

export type JobCardClosedModalProps = {
  jobCardId: string;
  jobCardNumber: string | null;
  dismissHref: string;
};

export function JobCardClosedModal({
  jobCardId,
  jobCardNumber,
  dismissHref,
}: JobCardClosedModalProps) {
  const router = useRouter();
  const primaryButtonRef = useRef<HTMLAnchorElement>(null);

  function dismiss() {
    router.replace(dismissHref, { scroll: false });
  }

  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissHref]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={dismiss} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="jc-closed-heading"
          className="relative flex w-full max-w-[560px] flex-col rounded-xl bg-white shadow-2xl"
        >
          <button
            onClick={dismiss}
            className="absolute right-4 top-4 rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
              <CheckCircle2 className="h-9 w-9 text-[#16A34A]" aria-hidden />
            </div>
            <h2 id="jc-closed-heading" className="mt-4 text-xl font-black text-[#111827]">
              Job Card Closed
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
              Job Card <span className="font-bold text-[#111827]">{jobCardNumber ?? "—"}</span> has been
              closed successfully.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-[#F3F4F6] px-6 pb-6 pt-4 sm:flex-row">
            <Link
              ref={primaryButtonRef}
              href="/dashboard"
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md bg-[#ED1C24] px-4 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Go to Dashboard
            </Link>
            <Link
              href={`/maintenance/work-orders/${jobCardId}`}
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
            >
              View Job Card
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
