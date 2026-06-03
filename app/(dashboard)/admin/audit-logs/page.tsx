import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function AuditLogsPage() {
  await requirePermission("admin.audit_logs.view");
  const supabase = await createSupabaseServerClient();
  const { data: logs } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100);

  return (
    <>
      <PageHeader title="Audit Logs" description="Review important administrative and workflow actions recorded by the system." />
      <div className="p-4 lg:p-6">
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {logs?.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-3 text-[#4B5563]">{formatDateTime(log.created_at)}</td>
                    <td className="px-4 py-3 font-semibold text-[#111827]">{log.action}</td>
                    <td className="px-4 py-3">{log.entity_type}</td>
                    <td className="px-4 py-3">{log.summary}</td>
                    <td className="px-4 py-3 text-xs text-[#4B5563]">{log.actor_id ?? "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
