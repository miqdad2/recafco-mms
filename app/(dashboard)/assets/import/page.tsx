import Link from "next/link";
import { History } from "lucide-react";

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
      <div className="p-4 lg:p-6">
        <AssetImportForm />
      </div>
    </>
  );
}
