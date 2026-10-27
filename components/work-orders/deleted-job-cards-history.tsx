import { Archive } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatKuwaitDateTime } from "@/lib/format/kuwait-time";
import type { DeletedJobCardRow } from "@/lib/backend/work-orders/job-card-deletion";

// Final Integration Review — read-only history of soft-deleted Job Cards for
// deletion reviewers (Manager / Super Admin), on the existing Job Cards page
// (?deleted=1). No links into work actions: a deleted Job Card is refused by
// every write path, and its rows (sessions, materials, files) are kept as is.

function decisionTone(status: string): "green" | "amber" | "red" | "gray" {
  if (status === "Approved") return "red";
  if (status === "Rejected") return "gray";
  return "amber";
}

export function DeletedJobCardsHistory({ rows }: { rows: DeletedJobCardRow[] }) {
  return (
    <section aria-labelledby="deleted-jc-heading" className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="border-b border-[#EEF2F6] px-4 py-2.5">
        <h2 id="deleted-jc-heading" className="flex items-center gap-2 text-sm font-black text-[#111827]">
          <Archive className="h-4 w-4 text-[#6B7280]" aria-hidden="true" />
          Deleted Job Cards
          <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-xs font-bold text-[#6B7280]">{rows.length}</span>
        </h2>
        <p className="mt-0.5 text-xs text-[#6B7280]">Read only. Deleted Job Cards are hidden from all lists and counts; their numbers are never reused.</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[#6B7280]">No Job Cards have been deleted.</p>
      ) : (
        <ul className="divide-y divide-[#EEF2F6]">
          {rows.map((r) => {
            const approved = [...r.history].reverse().find((h) => h.status === "Approved") ?? null;
            return (
              <li key={r.workOrderId}>
                <details className="group px-4 py-3">
                  <summary className="flex cursor-pointer list-none flex-col gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24] sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className="text-sm font-bold text-[#111827]">{r.workOrderNumber ?? "Job Card"}</span>
                      {r.assetLabel ? <span className="ml-2 text-[13px] text-[#4B5563]">{r.assetLabel}</span> : null}
                      <span className="mt-0.5 block text-xs text-[#6B7280]">
                        Deleted {formatKuwaitDateTime(r.deletedAt)}
                        {approved?.decidedByName ? ` by ${approved.decidedByName}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-[#2563EB] group-open:hidden">Show history</span>
                    <span className="hidden shrink-0 text-xs font-bold text-[#2563EB] group-open:inline">Hide history</span>
                  </summary>
                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 rounded-md bg-[#F9FAFB] p-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold text-[#6B7280]">Issue</dt>
                      <dd className="text-[#111827]">{r.issue ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-[#6B7280]">Status when deleted</dt>
                      <dd className="text-[#111827]">{r.statusWhenDeleted}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-[#6B7280]">Created</dt>
                      <dd className="text-[#111827]">
                        {formatKuwaitDateTime(r.createdAt)}
                        {r.createdByName ? ` by ${r.createdByName}` : ""}
                      </dd>
                    </div>
                  </dl>
                  <ol className="mt-3 space-y-2">
                    {r.history.length === 0 ? (
                      <li className="text-xs text-[#6B7280]">No deletion request is recorded for this Job Card.</li>
                    ) : (
                      r.history.map((h) => (
                        <li key={h.requestId} className="rounded-md border border-[#E5E7EB] p-3 text-[13px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge label={h.status} tone={decisionTone(h.status)} />
                            <span className="text-[#374151]">
                              Requested by <strong>{h.requestedByName}</strong> · {formatKuwaitDateTime(h.requestedAt)} · status then: {h.statusAtRequest}
                            </span>
                          </div>
                          <p className="mt-1 text-[#111827]">
                            <span className="font-semibold">Reason:</span> {h.reason}
                          </p>
                          {h.decidedAt ? (
                            <p className="mt-1 text-[#374151]">
                              {h.status} by <strong>{h.decidedByName ?? "—"}</strong> · {formatKuwaitDateTime(h.decidedAt)}
                              {h.decisionRemarks ? ` · Remarks: ${h.decisionRemarks}` : ""}
                            </p>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ol>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
