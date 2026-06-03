import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";

export default async function ProfilePage() {
  const context = await requireUser();

  return (
    <>
      <PageHeader title="Profile" description="Current authenticated user context and RECAFCO authorization scope." />
      <div className="p-4 lg:p-6">
        <section className="max-w-3xl rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#111827]">{context.profile.full_name}</h2>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-[#4B5563]">Email</dt>
              <dd className="font-semibold">{context.email ?? "Not available"}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#4B5563]">Role</dt>
              <dd className="font-semibold">{context.role?.name ?? "Not assigned"}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#4B5563]">Department</dt>
              <dd className="font-semibold">{context.department?.name ?? "Not assigned"}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#4B5563]">Status</dt>
              <dd>
                <StatusBadge label={context.profile.is_active ? "Active" : "Inactive"} tone={context.profile.is_active ? "green" : "red"} />
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
