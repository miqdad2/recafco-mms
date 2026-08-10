import { PageHeader } from "@/components/ui/page-header";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { WorkerProfilesView } from "@/components/admin/worker-profiles-view";
import { requirePermission } from "@/lib/auth/context";
import { canViewCosts as canViewCostsForContext, isManagerRole } from "@/lib/security/permissions";
import { listWorkerProfiles } from "@/lib/backend/workers/service";

// Work Assignment and Worker Profiles Foundation Unit 7, Task 3. Reuses
// work_orders.assign (see lib/backend/workers/service.ts for why) — no new
// permission was added for this unit.
//
// Worker Rate Visibility and Data Entry Lockdown Unit 10F.4, Task 1/2: this
// page itself was previously reachable and fully editable by anyone holding
// work_orders.assign (Data Entry included) — the Worker Activity page only
// ever hid its OWN link into here, never gated this destination. Data Entry
// still needs the page (it can still create a worker profile), but no
// longer sees the Hourly Rate column or the Edit/Deactivate/Reactivate
// actions — server-side enforcement lives in
// lib/backend/workers/service.ts's assertCanEditWorkerProfile, not here.
export default async function WorkerProfilesPage() {
  const context = await requirePermission("work_orders.assign");
  const workers = await listWorkerProfiles();
  const canViewCosts = canViewCostsForContext(context);
  const canManageWorkerProfiles = isManagerRole(context);

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <RealtimeRefresh watch={["worker_profile."]} />
      <PageHeader
        title="Worker Profiles"
        description="Maintenance workers available for Internal Team assignment — Supervisors, Technicians, and Helpers/Labor. These do not need a system login."
        actions={<PageNavigationActions secondaryLinks={[{ label: "Worker Activity", href: "/maintenance/assignments" }]} />}
      />
      <div className="p-4 lg:p-6">
        <WorkerProfilesView workers={workers} canViewCosts={canViewCosts} canManageWorkerProfiles={canManageWorkerProfiles} />
      </div>
    </>
  );
}
