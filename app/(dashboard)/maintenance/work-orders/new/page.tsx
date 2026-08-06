import { WorkOrderWizard } from "@/components/work-orders/work-order-wizard";
import { requirePermission } from "@/lib/auth/context";
import { getAssetPickerOptions } from "@/lib/assets/picker-options";
import { getActiveWorkerProfilesForAssignment } from "@/lib/backend/workers/service";

// New Job Card Modal Wizard Refactor: this standalone route is kept only as
// a direct-link/bookmark fallback (deep link, page refresh) — every in-app
// entry point (Dashboard, Job Cards list, Asset Details, Vehicles) now opens
// the same WorkOrderWizard as an overlay on top of the page the user was
// already on, via a `new_job_card=1` query flag, instead of navigating here.
// This page renders nothing but the modal itself, so a direct visit gets the
// same large centered popup rather than the old full-page layout.
export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; asset_id?: string }>;
}) {
  const context = await requirePermission("work_orders.manage");
  const sp = (await searchParams) ?? {};
  const preselectedAssetId = sp.asset_id ?? null;
  // Optional Work Assignment During Job Card Creation Unit 7C, Task 10.
  const canAssignAtCreation =
    context.role?.slug === "super_admin" || context.permissions.includes("work_orders.assign");

  const [assets, activeWorkers] = await Promise.all([
    getAssetPickerOptions(),
    canAssignAtCreation ? getActiveWorkerProfilesForAssignment() : Promise.resolve([]),
  ]);

  return (
    <WorkOrderWizard
      assets={assets}
      preselectedAssetId={preselectedAssetId}
      dismissHref="/maintenance/work-orders"
      activeWorkers={activeWorkers}
      canAssignAtCreation={canAssignAtCreation}
    />
  );
}
