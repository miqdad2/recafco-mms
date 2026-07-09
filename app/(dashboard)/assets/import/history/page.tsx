import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

type ImportMeta = {
  imported?: number;
  skipped?: number;
  failureCount?: number;
  rowsReceived?: number;
};

export default async function AssetImportHistoryPage() {
  await requirePermission("assets.manage");

  const logs = await prisma.audit_logs.findMany({
    where: { action: "asset.import" },
    orderBy: { created_at: "desc" },
    take: 50
  });

  const actorIds = [...new Set(logs.map((l) => l.actor_id).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length > 0
    ? await prisma.profiles.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, full_name: true }
      })
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a.full_name]));

  function fmt(iso: Date | string) {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  return (
    <>
      <PageHeader
        title="Asset Import History"
        description="Audit log of all Excel asset import operations. Shows imported, skipped, and failed counts per run."
        actions={
          <Link href="/assets/import">
            <Button variant="secondary" className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to Import
            </Button>
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        {logs.length === 0 ? (
          <div className="rounded-md border border-[#E5E7EB] bg-white p-10 text-center text-sm text-[#9CA3AF] shadow-sm">
            No import operations have been performed yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <p className="text-xs font-black uppercase text-[#4B5563]">Import log — last {logs.length} operations</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Date / Time</th>
                    <th className="px-4 py-3">Imported by</th>
                    <th className="px-4 py-3 text-center">Total rows</th>
                    <th className="px-4 py-3 text-center">Imported</th>
                    <th className="px-4 py-3 text-center">Skipped</th>
                    <th className="px-4 py-3 text-center">Failed</th>
                    <th className="px-4 py-3">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {logs.map((log) => {
                    const meta = (log.metadata ?? {}) as ImportMeta;
                    const imported = meta.imported ?? 0;
                    const skipped = meta.skipped ?? 0;
                    const failed = meta.failureCount ?? 0;
                    const total = meta.rowsReceived ?? "—";
                    const actorName = log.actor_id ? (actorMap.get(log.actor_id) ?? "Unknown") : "System";
                    return (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-[#4B5563]">{fmt(log.created_at)}</td>
                        <td className="px-4 py-3 font-semibold text-[#111827]">{actorName}</td>
                        <td className="px-4 py-3 text-center text-[#4B5563]">{String(total)}</td>
                        <td className="px-4 py-3 text-center">
                          {imported > 0 ? (
                            <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-[#16A34A]">{imported}</span>
                          ) : (
                            <span className="text-[#9CA3AF]">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {skipped > 0 ? (
                            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{skipped}</span>
                          ) : (
                            <span className="text-[#9CA3AF]">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {failed > 0 ? (
                            <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-[#ED1C24]">{failed}</span>
                          ) : (
                            <span className="text-[#9CA3AF]">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#4B5563]">{log.summary}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
