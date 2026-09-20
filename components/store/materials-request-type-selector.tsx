"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Wrench } from "lucide-react";

import { useLargeFormModal } from "@/components/ui/large-form-modal";

// Materials Request Type Selection Flow Unit 10G.58, Task 1 — the new first
// step shown when "New materials request" is opened with no ?type= yet
// (page.tsx only renders this component in that case). Picking an option and
// clicking Continue just navigates to the same modal URL with &type=job_card
// or &type=general added — page.tsx then renders the existing
// PartsRequestWizard (completely unchanged) or the new
// GeneralInventoryRequestForm for that request, so the two flows never share
// component state.

type RequestType = "job_card" | "general";

export function MaterialsRequestTypeSelector({
  baseHref,
  cancelHref
}: {
  baseHref: string;
  // Standalone (non-modal) page usage — modal usage instead goes through
  // useLargeFormModal()'s dirty-aware close below, same as every other step
  // of this wizard.
  cancelHref?: string;
}) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const [selected, setSelected] = useState<RequestType | null>(null);

  function continueTo() {
    if (!selected) return;
    const url = new URL(baseHref, "http://placeholder.local");
    url.searchParams.set("type", selected);
    router.push(`${url.pathname}${url.search}`, { scroll: false });
  }

  const options: Array<{
    value: RequestType;
    title: string;
    description: string;
    icon: typeof Wrench;
  }> = [
    {
      value: "job_card",
      title: "For Job Card",
      description: "Request materials linked to a maintenance Job Card.",
      icon: Wrench
    },
    {
      value: "general",
      title: "General Inventory / Stock Request",
      description: "Request materials for store stock or general inventory. No Job Card required.",
      icon: Boxes
    }
  ];

  return (
    <div>
      <p className="mb-5 text-sm text-[#4B5563]">Choose how this material request will be used.</p>

      <div role="radiogroup" aria-label="Request Type" className="grid gap-3 sm:grid-cols-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(opt.value)}
              className={`focus-ring flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition ${
                isSelected
                  ? "border-[#ED1C24] bg-red-50/60"
                  : "border-[#E5E7EB] bg-white hover:border-[#ED1C24]/50 hover:shadow-md"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                    isSelected ? "bg-[#ED1C24] text-white" : "bg-gray-100 text-[#4B5563]"
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                </span>
                <span className="font-bold text-[#111827]">{opt.title}</span>
              </div>
              <p className="text-xs text-[#4B5563]">{opt.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#E5E7EB] pt-5">
        {modal ? (
          <button
            type="button"
            onClick={() => modal.requestClose()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#ED1C24] shadow-sm transition hover:bg-red-50"
          >
            Cancel
          </button>
        ) : (
          <Link
            href={cancelHref ?? "/store/parts-requests"}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#ED1C24] shadow-sm transition hover:bg-red-50"
          >
            Cancel
          </Link>
        )}
        <button
          type="button"
          disabled={!selected}
          onClick={continueTo}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
