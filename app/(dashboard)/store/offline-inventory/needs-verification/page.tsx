import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { NeedsVerificationView } from "@/components/store/needs-verification-view";
import { requirePermission } from "@/lib/auth/context";
import { listVerificationEntries } from "@/lib/backend/store/opening-stock-verification";

// Inventory Control → Needs Verification: every Opening Stock row that was
// held on import, with what is wrong and who can fix it. Same access as
// Inventory Control itself (parts.view); editing and deciding are checked
// per role in the service.
export default async function NeedsVerificationPage() {
  const context = await requirePermission("parts.view");
  const list = await listVerificationEntries(context);

  return (
    <>
      <PageHeader
        title={`Needs Verification — ${list.pending} material${list.pending !== 1 ? "s" : ""}`}
        description="Materials from the opening stock import that must be checked before their stock is recorded."
        actions={
          <Link
            href="/store/offline-inventory"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Inventory Control
          </Link>
        }
      />
      <div className="p-3 sm:p-4 lg:p-6">
        <NeedsVerificationView list={list} />
      </div>
    </>
  );
}
