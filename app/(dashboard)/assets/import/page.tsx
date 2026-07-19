import Link from "next/link";
import { History, ArrowRight } from "lucide-react";

import { requirePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { AssetImportForm } from "@/components/assets/asset-import-form";

export default async function AssetImportPage() {
  await requirePermission("assets.manage");

  return (
    <>
      <PageHeader
        title="Import Assets from Excel"
        description="Upload an Excel (.xlsx) file to bulk-import assets. Duplicates are detected and skipped. Existing assets are never overwritten."
        actions={
          <Link href="/assets/import/history">
            <Button variant="secondary" className="gap-2">
              <History className="h-4 w-4" aria-hidden="true" />
              Import history
            </Button>
          </Link>
        }
      />
      <div className="space-y-4 p-4 lg:p-6">
        {/* ── "When should I use this page?" guidance ─────────────────────── */}
        <section className="rounded-md border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-bold text-[#111827]">When should I use this page?</p>
          <p className="mt-1 text-sm leading-6 text-[#374151]">
            Use Import Excel when you need to add many assets or vehicles at once.
            For one new asset or vehicle, go back and use New Asset.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Link
              href="/assets/new"
              className="flex items-center justify-between rounded-md border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
            >
              Add one vehicle manually → New Asset
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Link>
            <div className="flex items-center justify-between rounded-md border border-[#ED1C24] bg-white px-4 py-2.5 text-sm font-semibold text-[#ED1C24]">
              Upload many vehicles → Continue with Excel Import below
            </div>
          </div>
        </section>

        {/* ── Vehicle Excel Import guidance ───────────────────────────────── */}
        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-[#111827]">Vehicle Excel Import</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Required vehicle columns</p>
              <ul className="mt-1.5 space-y-1 text-sm text-[#374151]">
                <li>Asset Code</li>
                <li>Asset Name</li>
                <li>Category</li>
                <li>Brand</li>
                <li>Plate Number</li>
                <li>Model Year</li>
                <li>Insurance Expiry Date</li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Optional vehicle columns</p>
              <ul className="mt-1.5 space-y-1 text-sm text-[#374151]">
                <li>Chassis Number</li>
                <li>Engine Number</li>
                <li>Registration Expiry Date</li>
                <li>Current Kilometer Reading</li>
                <li>Assigned Driver</li>
                <li>Remarks</li>
              </ul>
            </div>
          </div>
          <p className="mt-3 text-sm text-[#374151]">
            Vehicles must use one of these categories: <strong>Car, Pickup, Bus, Truck, Loader, Forklift, Crane</strong>.
          </p>
        </section>

        <div id="excel-import-form">
          <AssetImportForm />
        </div>
      </div>
    </>
  );
}
