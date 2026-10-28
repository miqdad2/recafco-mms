import { redirect } from "next/navigation";

import { AssetLocationsManager } from "@/components/assets/asset-locations-manager";
import { PageBackButton } from "@/components/layout/page-back-button";
import { PageHeader } from "@/components/ui/page-header";
import { getAssetLocationRows } from "@/lib/assets/asset-locations";
import { requireUser } from "@/lib/auth/context";
import { canManageAssetLocations } from "@/lib/security/permissions";

// Site Locations — the approved sites / projects for the Send to Site
// dropdown (route and table keep their original asset-locations name). Manager and Super Admin only; every action behind this
// page checks canManageAssetLocations again on the server.
export default async function AssetLocationsPage() {
  const context = await requireUser();
  if (!canManageAssetLocations(context)) redirect("/dashboard?error=permission-denied");

  const rows = await getAssetLocationRows();

  return (
    <>
      <PageHeader
        title="Site Locations"
        description="Manage approved site/project locations used when sending assets to site."
        actions={<PageBackButton />}
      />
      <AssetLocationsManager rows={rows} />
    </>
  );
}
