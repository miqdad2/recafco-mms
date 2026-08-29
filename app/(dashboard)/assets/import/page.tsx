import Link from "next/link";
import { History, ArrowRight } from "lucide-react";

import { requirePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { AssetImportForm } from "@/components/assets/asset-import-form";

// Import Assets Page UI Simplification Unit 10G.39. This page is UI-only —
// the actual parsing/preview/add/replace logic all still lives in
// components/assets/asset-import-form.tsx and app/actions/asset-import.ts,
// untouched (Task 9). Everything here just makes the same feature easier
// for a normal maintenance user to follow: a 3-step guide, a simpler "when
// do I use this" card, and a de-emphasized Import History link (Task 7 —
// "ghost" instead of "secondary" so it reads as a minor, optional action).

const IMPORT_STEPS = [
  { n: 1, title: "Upload Excel", text: "Upload the maintenance asset Excel file." },
  { n: 2, title: "Check Preview", text: "Review the assets before saving." },
  { n: 3, title: "Add or Replace Assets", text: "Choose whether to add assets or replace the full list." },
] as const;

function ImportStepsGuide() {
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {IMPORT_STEPS.map((s) => (
        <div key={s.n} className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#111827] text-xs font-black text-white">
              {s.n}
            </span>
            <p className="text-sm font-bold text-[#111827]">{s.title}</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#4B5563]">{s.text}</p>
        </div>
      ))}
    </section>
  );
}

export default async function AssetImportPage() {
  const context = await requirePermission("assets.manage");
  const canReplace = context.role?.slug === "super_admin";

  return (
    <>
      <PageHeader
        title="Import Assets from Excel"
        description="Upload the maintenance asset Excel file to add or replace assets. Existing assets are never overwritten unless you choose Replace Asset Register."
        actions={
          <Link href="/assets/import/history">
            <Button variant="ghost" className="gap-2">
              <History className="h-4 w-4" aria-hidden="true" />
              Import history
            </Button>
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        <div className="mx-auto max-w-4xl space-y-5">

          {/* Task 1 — simple 3-step guide */}
          <ImportStepsGuide />

          {/* Task 2 — "When should I use this page?" help card */}
          <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-[#111827]">When should I use this page?</p>
            <p className="mt-1 text-sm leading-6 text-[#4B5563]">
              Use this page when you need to upload many assets from Excel.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-[#E5E7EB] p-4">
                <p className="text-sm font-bold text-[#111827]">New Asset</p>
                <p className="mt-1 text-xs leading-5 text-[#4B5563]">For adding one asset only.</p>
                <Link
                  href="/assets?new_asset=1"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
                >
                  Add one asset
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
              <div className="rounded-md border border-[#ED1C24]/30 bg-red-50/40 p-4">
                <p className="text-sm font-bold text-[#111827]">Import Excel</p>
                <p className="mt-1 text-xs leading-5 text-[#4B5563]">For adding or replacing many assets from an Excel file.</p>
                <a
                  href="#excel-import-form"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-red-700"
                >
                  Continue with Excel Import
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          </section>

          <div id="excel-import-form">
            <AssetImportForm canReplace={canReplace} />
          </div>

        </div>
      </div>
    </>
  );
}
