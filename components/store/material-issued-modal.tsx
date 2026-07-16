"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";

export type IssuedItem = {
  materialName: string | null;
  quantity: number;
  unit: string;
};

export type MaterialIssuedModalProps = {
  requestNumber: string | null;
  jobCardNumber: string | null;
  jobCardPreviewHref: string | null;
  assetName: string | null;
  issuedItems: IssuedItem[];
  attachmentWarning: boolean;
  dismissHref: string;
};

export function MaterialIssuedModal({
  requestNumber,
  jobCardNumber,
  jobCardPreviewHref,
  assetName,
  issuedItems,
  attachmentWarning,
  dismissHref,
}: MaterialIssuedModalProps) {
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

  const singleItem = issuedItems.length === 1 ? issuedItems[0] : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={dismiss} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mi-issued-heading"
          className="relative flex w-full max-w-[560px] flex-col rounded-xl bg-white shadow-2xl"
        >
          <button
            onClick={dismiss}
            className="absolute right-4 top-4 rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex flex-col items-center px-6 pb-2 pt-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
              <CheckCircle2 className="h-9 w-9 text-[#16A34A]" aria-hidden />
            </div>
            <h2 id="mi-issued-heading" className="mt-4 text-xl font-black text-[#111827]">
              Material Issued
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
              Material has been issued successfully.
            </p>

            {attachmentWarning && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Material was issued, but some attachments failed to upload.</span>
              </div>
            )}
          </div>

          <div className="px-6 py-4">
            <div className="mb-4 space-y-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm">
              <p className="text-[#4B5563]">
                <span className="font-semibold text-[#111827]">Materials Request:</span>{" "}
                {requestNumber ?? "—"}
              </p>
              <p className="text-[#4B5563]">
                <span className="font-semibold text-[#111827]">Linked Job Card:</span>{" "}
                {jobCardNumber ? (
                  jobCardPreviewHref ? (
                    <Link href={jobCardPreviewHref} className="font-semibold text-[#ED1C24] hover:underline">
                      {jobCardNumber}
                    </Link>
                  ) : (
                    jobCardNumber
                  )
                ) : (
                  "—"
                )}
              </p>
              {assetName && (
                <p className="text-[#4B5563]">
                  <span className="font-semibold text-[#111827]">Asset / Equipment:</span> {assetName}
                </p>
              )}
              {singleItem ? (
                <>
                  <p className="text-[#4B5563]">
                    <span className="font-semibold text-[#111827]">Material:</span>{" "}
                    {singleItem.materialName ?? "—"}
                  </p>
                  <p className="text-[#4B5563]">
                    <span className="font-semibold text-[#111827]">Quantity Issued:</span>{" "}
                    {singleItem.quantity} {singleItem.unit}
                  </p>
                </>
              ) : issuedItems.length > 1 ? (
                <div className="text-[#4B5563]">
                  <span className="font-semibold text-[#111827]">Materials Issued:</span>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {issuedItems.map((item, idx) => (
                      <li key={idx}>
                        {item.materialName ?? "Material"} — {item.quantity} {item.unit}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Current status</span>
              <StatusBadge label="Issued" tone="green" />
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[#111827]">
              The material balance has been updated in Offline Inventory Control.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#111827]">
              <span className="font-bold">Next: </span>
              The issued material is now recorded against the linked Job Card.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-[#F3F4F6] px-6 pb-6 pt-4 sm:flex-row">
            <Link
              ref={primaryButtonRef}
              href="/store/parts-requests"
              onClick={dismiss}
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md bg-[#ED1C24] px-4 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Go to Materials Requests
            </Link>
            <Link
              href="/store/offline-inventory"
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
            >
              Offline Inventory
            </Link>
            <Link
              href="/store/offline-inventory/movements"
              className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#4B5563] transition hover:bg-gray-50"
            >
              Movement History
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
