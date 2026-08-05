import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { WorkerProfilesView } from "@/components/admin/worker-profiles-view";
import { requirePermission } from "@/lib/auth/context";
import { listWorkerProfiles } from "@/lib/backend/workers/service";

// Work Assignment and Worker Profiles Foundation Unit 7, Task 3. Reuses
// work_orders.assign (see lib/backend/workers/service.ts for why) — no new
// permission was added for this unit.
export default async function WorkerProfilesPage() {
  await requirePermission("work_orders.assign");
  const workers = await listWorkerProfiles();

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <RealtimeRefresh watch={["worker_profile."]} />
      <PageHeader
        title="Worker Profiles"
        description="Maintenance workers available for Internal Team assignment — Supervisors, Technicians, and Helpers/Labor. These do not need a system login."
      />
      <div className="p-4 lg:p-6">
        <WorkerProfilesView workers={workers} />
      </div>
    </>
  );
}
