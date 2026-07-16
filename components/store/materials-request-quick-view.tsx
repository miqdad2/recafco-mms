"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";

export type MaterialsRequestQuickViewItem = {
  id: string;
  description: string;
  part_number: string | null;
  ss_rec_code: string | null;
  quantity_requested: number;
  issued_quantity: number;
};

export type MaterialsRequestQuickViewData = {
  id: string;
  parts_request_number: string | null;
  displayStatus: string;
  tone: "green" | "amber" | "red" | "blue" | "gray";
  work_order_number: string | null;
  asset_name: string | null;
  asset_code: string | null;
  requested_by_name: string | null;
  remarks: string | null;
  items: MaterialsRequestQuickViewItem[];
  closeHref: string;
  jobCardPreviewHref: string | null;
  detailHref: string;
};

export function MaterialsRequestQuickView({ data }: { data: MaterialsRequestQuickViewData }) {
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function close() {
    router.replace(data.closeHref, { scroll: false });
  }

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.closeHref]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={close} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mrqv-heading"
          className="relative flex w-full max-w-[640px] flex-col rounded-xl bg-white shadow-2xl max-h-[90vh] sm:max-h-[85vh]"
        >
          <div className="flex shrink-0 items-start gap-3 rounded-t-xl border-b border-[#E5E7EB] bg-[#F5F6F8] px-5 py-4">
            <div className="min-w-0 flex-1">
              <p id="mrqv-heading" className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">
                {data.parts_request_number ?? "Materials Request"}
              </p>
              <div className="mt-2">
                <StatusBadge label={data.displayStatus} tone={data.tone} />
              </div>
            </div>
            <button
              ref={closeButtonRef}
              onClick={close}
              className="mt-0.5 shrink-0 rounded-md p-1.5 text-[#4B5563] hover:bg-gray-200 hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
              aria-label="Close quick view"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#E5E7EB]">
            <section className="grid gap-3 px-5 py-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Linked Job Card</p>
                {data.work_order_number ? (
                  data.jobCardPreviewHref ? (
                    <Link
                      href={data.jobCardPreviewHref}
                      className="mt-0.5 inline-block text-sm font-bold text-[#ED1C24] hover:underline"
                    >
                      {data.work_order_number}
                    </Link>
                  ) : (
                    <p className="mt-0.5 text-sm font-semibold text-[#111827]">{data.work_order_number}</p>
                  )
                ) : (
                  <p className="mt-0.5 text-sm text-[#9CA3AF]">—</p>
                )}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Asset / Equipment</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">
                  {data.asset_name ? `${data.asset_name}${data.asset_code ? ` (${data.asset_code})` : ""}` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Requested By</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">{data.requested_by_name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Items</p>
                <p className="mt-0.5 text-sm font-semibold text-[#111827]">{data.items.length}</p>
              </div>
              {data.remarks && (
                <div className="sm:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Remarks</p>
                  <p className="mt-0.5 text-sm text-[#4B5563]">{data.remarks}</p>
                </div>
              )}
            </section>

            <section className="px-5 py-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#4B5563]">Requested Materials</p>
              {data.items.length === 0 ? (
                <p className="text-sm text-[#9CA3AF]">No materials listed for this request.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-[#E5E7EB]">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                      <tr>
                        <th className="px-3 py-2 text-left">Material</th>
                        <th className="px-3 py-2 text-left">Part / SS</th>
                        <th className="px-3 py-2 text-right">Requested</th>
                        <th className="px-3 py-2 text-right">Received</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {data.items.map((item) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2 font-semibold text-[#111827]">{item.description}</td>
                          <td className="px-3 py-2 text-[#4B5563]">
                            {item.part_number ?? item.ss_rec_code ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#111827]">
                            {item.quantity_requested}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#4B5563]">
                            {item.issued_quantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-[#E5E7EB] px-5 py-4">
            <Link
              href={data.detailHref}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#c8181e]"
            >
              Full Details <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
