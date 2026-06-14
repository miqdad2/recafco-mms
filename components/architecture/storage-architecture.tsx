import { storageBuckets, storageFileTypes, storageFlow } from "@/lib/architecture/config";
import { ChipList, FlowRail, SectionShell } from "@/components/architecture/shared";

export function StorageArchitecture() {
  return (
    <SectionShell eyebrow="Private files" title="File Upload and Storage Architecture">
      <div className="space-y-4">
        <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <FlowRail steps={storageFlow} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-black text-[#111827]">Private buckets</h3>
            <ChipList items={storageBuckets} />
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-2">
            <h3 className="mb-3 text-base font-black text-[#111827]">Supported business files</h3>
            <ChipList items={storageFileTypes} />
          </div>
        </div>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-[#7F1D1D]">
          No public file access. Signed URLs only. File type and size validation happen server-side, and viewing remains role-based.
        </div>
      </div>
    </SectionShell>
  );
}
