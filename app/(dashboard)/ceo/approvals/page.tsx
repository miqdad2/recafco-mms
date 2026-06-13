import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  Landmark,
  ShieldCheck,
  ShoppingCart,
  ArrowRight,
  type LucideIcon
} from "lucide-react";

import { ceoApprovePurchaseAction, ceoRejectPurchaseAction, ceoRequestClarificationAction } from "@/app/actions/ceo-approvals";
import { Button } from "@/components/ui/button";
import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { cn } from "@/lib/utils";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CeoApprovalsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const context = await requirePermission("ceo.approve");
  const params = (await searchParams) ?? {};
  const success = single(params.success);
  const error = single(params.error);

  const [settings, pendingRequests, recentDecisions, financePendingCount] = await Promise.all([
    prisma.app_settings.findUnique({ where: { id: SETTINGS_ID } }),
    prisma.purchase_requests.findMany({
      where: { status: "Pending CEO Approval" },
      orderBy: [{ estimated_total: "desc" }, { created_at: "asc" }],
      include: {
        purchase_request_items: {
          orderBy: { created_at: "asc" },
          include: {
            parts: { select: { part_code: true, part_name: true, current_stock: true, minimum_stock: true } }
          }
        },
        parts_requests: {
          select: {
            id: true,
            parts_request_number: true,
            status: true,
            remarks: true,
            departments: { select: { name: true, code: true } }
          }
        },
        work_orders: {
          select: {
            id: true,
            work_order_number: true,
            ordered_by: true,
            status: true,
            priority: true,
            job_location: true,
            maintenance_type: true,
            worker_type: true,
            operator_complaint: true,
            description_of_work: true,
            departments: { select: { name: true, code: true } },
            assets: {
              select: {
                asset_code: true,
                asset_name: true,
                category: true,
                location: true,
                status: true
              }
            }
          }
        },
        profiles_purchase_requests_finance_approved_byToprofiles: {
          select: { full_name: true, job_title: true }
        }
      }
    }),
    prisma.purchase_requests.findMany({
      where: { status: { in: ["Approved", "Rejected"] }, ceo_approved_by: { not: null } },
      orderBy: { ceo_approved_at: "desc" },
      take: 6,
      select: {
        id: true,
        purchase_request_number: true,
        status: true,
        estimated_total: true,
        ceo_approved_at: true,
        ceo_comments: true
      }
    }),
    prisma.purchase_requests.count({ where: { status: "Pending Finance Approval" } })
  ]);

  const currency = settings?.default_currency ?? "KWD";
  const threshold = Number(settings?.ceo_approval_threshold ?? 1000);
  const totalPendingValue = pendingRequests.reduce((sum, r) => sum + Number(r.estimated_total ?? 0), 0);
  const urgentCount = pendingRequests.filter((r) => ["High", "Urgent"].includes(r.work_orders?.priority ?? "")).length;
  const oldestPending = pendingRequests[0]?.created_at;
  const hasDecisions = pendingRequests.length > 0;

  return (
    <>
      <PageHeader
        title="CEO Approval Desk"
        description="High-value purchase requests reach you only after finance review. Each card shows the full context so you can decide immediately."
        actions={
          <>
            <Link href="/dashboard">
              <Button variant="secondary">Dashboard</Button>
            </Link>
            <Link href="/purchase/requests">
              <Button variant="secondary">All purchases</Button>
            </Link>
          </>
        }
      />

      <div className="space-y-5 p-4 lg:p-6">
        {success ? <Banner tone="green" message={successMessage(success)} /> : null}
        {error ? <Banner tone="red" message={error} /> : null}

        {/* KPI strip */}
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ExecutiveStat icon={Landmark} label="CEO decisions" value={pendingRequests.length} detail="Waiting for your signature" tone={pendingRequests.length ? "red" : "green"} />
          <ExecutiveStat icon={ShoppingCart} label="Pending value" value={<CostVisibilityGuard context={context}>{formatMoney(totalPendingValue, currency)}</CostVisibilityGuard>} detail={`Approval threshold: ${formatMoney(threshold, currency)}`} tone={totalPendingValue > 0 ? "amber" : "green"} />
          <ExecutiveStat icon={AlertTriangle} label="High priority" value={urgentCount} detail="Urgent or high-priority linked work orders" tone={urgentCount ? "red" : "green"} />
          <ExecutiveStat icon={Clock3} label="Finance queue" value={financePendingCount} detail="Still awaiting finance before reaching you" tone={financePendingCount ? "amber" : "green"} />
        </section>

        {/* Decision brief — contextual strip */}
        {hasDecisions ? (
          <div className={cn(
            "flex flex-col gap-3 rounded-md border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between",
            urgentCount > 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
          )}>
            <div className="flex items-start gap-3">
              <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", urgentCount > 0 ? "text-[#ED1C24]" : "text-[#F59E0B]")} aria-hidden="true" />
              <div>
                <p className={cn("text-base font-black", urgentCount > 0 ? "text-[#ED1C24]" : "text-[#92400E]")}>
                  {pendingRequests.length} purchase request{pendingRequests.length !== 1 ? "s" : ""} need{pendingRequests.length === 1 ? "s" : ""} your decision
                </p>
                <p className="mt-0.5 text-sm text-[#4B5563]">
                  Total exposure: <span className="font-bold text-[#111827]"><CostVisibilityGuard context={context}>{formatMoney(totalPendingValue, currency)}</CostVisibilityGuard></span>
                  {oldestPending ? <> · Oldest since {formatDate(oldestPending)}</> : null}
                </p>
              </div>
            </div>
            {urgentCount > 0 && (
              <span className="w-fit rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-black uppercase text-[#ED1C24]">
                {urgentCount} urgent
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[#16A34A]" aria-hidden="true" />
            <div>
              <p className="font-black text-[#15803D]">All clear — no CEO decisions pending</p>
              <p className="text-sm text-[#4B5563]">
                {financePendingCount > 0
                  ? `${financePendingCount} request${financePendingCount !== 1 ? "s" : ""} still with finance. They will appear here after finance approval.`
                  : "No requests are waiting in the approval pipeline."}
              </p>
            </div>
          </div>
        )}

        {/* Approval cards */}
        {hasDecisions ? (
          <section className="space-y-6">
            {pendingRequests.map((request, index) => {
              const workOrder = request.work_orders;
              const asset = workOrder?.assets;
              const partsRequest = request.parts_requests;
              const financeApprover = request.profiles_purchase_requests_finance_approved_byToprofiles;
              const amount = Number(request.estimated_total ?? 0);
              const priority = workOrder?.priority ?? "Normal";
              const isUrgent = priority === "Urgent" || priority === "High";
              const itemSummary = request.purchase_request_items.slice(0, 4);
              const hiddenItems = request.purchase_request_items.length - itemSummary.length;
              const dept = workOrder?.departments?.name ?? partsRequest?.departments?.name;

              return (
                <article key={request.id} className="overflow-hidden rounded-lg border border-[#DDE2EA] bg-white shadow-md">

                  {/* Card header — priority stripe + request identity + amount */}
                  <div className={cn("border-l-4 px-5 pt-5 pb-4", isUrgent ? "border-l-[#ED1C24]" : "border-l-[#2563EB]")}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

                      {/* Left: identity */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[#111827] px-2.5 py-0.5 text-xs font-black text-white">
                            Decision {index + 1} of {pendingRequests.length}
                          </span>
                          <StatusBadge label={priority} tone={isUrgent ? "red" : "gray"} />
                          {amount >= threshold && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                              Above threshold
                            </span>
                          )}
                        </div>
                        <h3 className="mt-3 text-2xl font-black text-[#111827]">
                          {request.purchase_request_number ?? "Purchase request"}
                        </h3>
                        {/* Asset / context summary line */}
                        <p className="mt-1 text-sm leading-6 text-[#4B5563]">
                          {asset ? (
                            <><span className="font-bold text-[#111827]">{asset.asset_name}</span> ({asset.asset_code})</>
                          ) : "Asset not linked"}
                          {dept ? <> · {dept}</> : null}
                          {workOrder?.job_location ? <> · {workOrder.job_location}</> : null}
                        </p>
                        {workOrder?.operator_complaint ? (
                          <p className="mt-2 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-sm text-[#4B5563]">
                            <span className="font-bold text-[#111827]">Complaint: </span>
                            {workOrder.operator_complaint}
                          </p>
                        ) : null}
                      </div>

                      {/* Right: amount + work order */}
                      <div className="shrink-0 rounded-lg border border-[#DDE2EA] bg-[#F8FAFC] p-4 text-center lg:min-w-[11rem]">
                        <p className="text-xs font-black uppercase text-[#4B5563]">Decision value</p>
                        <p className="mt-2 text-3xl font-black text-[#111827]">
                          <CostVisibilityGuard context={context}>{formatMoney(amount, currency)}</CostVisibilityGuard>
                        </p>
                        {workOrder && (
                          <Link href={`/maintenance/work-orders/${workOrder.id}`} className="mt-2 flex items-center justify-center gap-1 text-xs font-bold text-[#2563EB] hover:text-[#ED1C24]">
                            {workOrder.work_order_number}
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Detail panels */}
                  <div className="grid gap-px border-t border-[#E5E7EB] bg-[#E5E7EB] lg:grid-cols-3">

                    {/* Why it matters */}
                    <div className="bg-white p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-[#ED1C24]" aria-hidden="true" />
                        <h4 className="text-sm font-black text-[#111827]">Why it matters</h4>
                      </div>
                      <dl className="space-y-2">
                        <DetailRow label="Blocker" value={workOrder?.status === "Waiting for Purchase" ? "Work order blocked" : workOrder?.status ?? "Purchase escalation"} urgent={workOrder?.status === "Waiting for Purchase"} />
                        <DetailRow label="Maintenance type" value={workOrder?.maintenance_type ?? "Not specified"} />
                        <DetailRow label="Asset status" value={asset?.status ?? "Unknown"} urgent={asset?.status === "Breakdown"} />
                        <DetailRow label="Department" value={dept ?? "Not recorded"} />
                      </dl>
                    </div>

                    {/* Items being purchased */}
                    <div className="bg-white p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-[#ED1C24]" aria-hidden="true" />
                        <h4 className="text-sm font-black text-[#111827]">
                          Items ({request.purchase_request_items.length})
                        </h4>
                      </div>
                      <div className="space-y-2">
                        {itemSummary.map((item) => (
                          <div key={item.id} className="flex items-start justify-between gap-2 rounded border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-[#111827]">{item.description}</p>
                              {item.parts?.part_code && (
                                <p className="text-xs text-[#4B5563]">{item.parts.part_code}</p>
                              )}
                            </div>
                            <span className="shrink-0 text-xs font-bold text-[#4B5563]">×{String(item.quantity)}</span>
                          </div>
                        ))}
                        {hiddenItems > 0 && (
                          <p className="text-xs font-semibold text-[#4B5563]">+ {hiddenItems} more item{hiddenItems !== 1 ? "s" : ""}</p>
                        )}
                      </div>
                    </div>

                    {/* Approval chain — trust signals */}
                    <div className="bg-white p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-[#16A34A]" aria-hidden="true" />
                        <h4 className="text-sm font-black text-[#111827]">Already reviewed</h4>
                      </div>
                      <div className="space-y-2">
                        <ApprovalStep
                          label="Purchase officer"
                          value={request.supplier || "Supplier recorded"}
                          done
                        />
                        <ApprovalStep
                          label="Finance approval"
                          value={financeApprover?.full_name ?? "Finance approved"}
                          done
                        />
                        <ApprovalStep
                          label="CEO decision"
                          value="Your signature required"
                          done={false}
                        />
                      </div>
                      {partsRequest && (
                        <Link href={`/store/parts-requests/${partsRequest.id}`} className="mt-3 flex items-center gap-1 text-xs font-bold text-[#2563EB] hover:text-[#ED1C24]">
                          View parts request {partsRequest.parts_request_number}
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Quick decision zone */}
                  <div className="border-t-2 border-[#111827] bg-[#111827] p-5">
                    <form className="grid gap-4 lg:grid-cols-[1fr_auto]">
                      <input type="hidden" name="purchase_request_id" value={request.id} />
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wide text-[#9CA3AF]">
                          Decision note <span className="font-normal normal-case text-[#6B7280]">(optional — recorded for audit trail)</span>
                        </label>
                        <textarea
                          className="focus-ring mt-2 min-h-[4.5rem] w-full rounded-md border border-[#374151] bg-[#1F2937] px-3 py-2 text-sm text-white placeholder-[#6B7280] focus:border-[#4B5563]"
                          name="comments"
                          placeholder="Add a note explaining your decision…"
                        />
                        {request.ceo_comments ? (
                          <p className="mt-2 rounded-md border border-amber-700 bg-amber-950 px-3 py-2 text-xs text-amber-300">
                            Previous note: {request.ceo_comments}
                          </p>
                        ) : null}
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col justify-end gap-2 lg:min-w-[15rem]">
                        <button
                          formAction={ceoApprovePurchaseAction}
                          className="focus-ring flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-[#16A34A] px-5 text-base font-black text-white shadow-sm transition hover:bg-[#15803D] active:scale-[0.98]"
                        >
                          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                          <span>
                            Approve
                            <span className="ml-1 font-normal opacity-80">
                              — <CostVisibilityGuard context={context}>{formatMoney(amount, currency)}</CostVisibilityGuard>
                            </span>
                          </span>
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            formAction={ceoRequestClarificationAction}
                            className="focus-ring flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-[#374151] bg-[#1F2937] px-3 text-sm font-bold text-[#9CA3AF] transition hover:border-[#4B5563] hover:text-white"
                          >
                            <Clock3 className="h-4 w-4" aria-hidden="true" />
                            Clarify
                          </button>
                          <button
                            formAction={ceoRejectPurchaseAction}
                            className="focus-ring flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-red-800 bg-red-950 px-3 text-sm font-bold text-red-400 transition hover:border-red-600 hover:text-red-300"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
            <EmptyState title="No CEO approvals waiting" message="High-value purchase requests will appear here after finance approval." />
          </section>
        )}

        {/* Recent decisions */}
        {recentDecisions.length ? (
          <section className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] p-4">
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Recent CEO decisions</p>
              <h2 className="mt-1 text-lg font-black text-[#111827]">Your last approvals and rejections</h2>
            </div>
            <div className="divide-y divide-[#E5E7EB]">
              {recentDecisions.map((decision) => (
                <Link
                  key={decision.id}
                  href={`/purchase/requests/${decision.id}`}
                  className="flex flex-col gap-2 p-4 transition hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-black text-[#111827]">{decision.purchase_request_number}</p>
                    <p className="text-sm text-[#4B5563]">{decision.ceo_comments || "No CEO note recorded"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-[#111827]">
                      <CostVisibilityGuard context={context}>{formatMoney(Number(decision.estimated_total ?? 0), currency)}</CostVisibilityGuard>
                    </span>
                    <StatusBadge label={decision.status} tone={decision.status === "Approved" ? "green" : "red"} />
                    {decision.ceo_approved_at && (
                      <span className="text-xs text-[#9CA3AF]">{formatDate(decision.ceo_approved_at)}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function successMessage(value: string) {
  if (value === "approved") return "Approval saved. The purchase and maintenance teams have been notified.";
  if (value === "rejected") return "Rejection recorded. The relevant teams have been notified.";
  if (value === "clarification") return "Clarification request sent to the workflow teams.";
  return "Decision saved.";
}

function formatMoney(value: number, currency: string) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)} ${currency}`;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

// ── UI primitives ─────────────────────────────────────────────────────────────

function Banner({ tone, message }: { tone: "green" | "red"; message: string }) {
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm font-semibold", tone === "green" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800")}>
      {message}
    </div>
  );
}

function ExecutiveStat({ icon: Icon, label, value, detail, tone }: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  detail: string;
  tone: "green" | "amber" | "red";
}) {
  return (
    <div className={cn("rounded-md border bg-white p-4 shadow-sm", tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : "border-green-200")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#4B5563]">{label}</p>
          <p className="mt-2 text-2xl font-black text-[#111827]">{value}</p>
        </div>
        <span className={cn("rounded-md p-2", tone === "red" ? "bg-red-50 text-red-600" : tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-green-50 text-green-600")}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-sm text-[#4B5563]">{detail}</p>
    </div>
  );
}

function DetailRow({ label, value, urgent = false }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-[#F0F2F5] py-1.5 first:border-t-0 first:pt-0">
      <span className="text-xs text-[#4B5563]">{label}</span>
      <span className={cn("max-w-40 text-right text-xs font-semibold", urgent ? "text-[#ED1C24]" : "text-[#111827]")}>{value}</span>
    </div>
  );
}

function ApprovalStep({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black", done ? "bg-[#16A34A] text-white" : "border-2 border-[#F59E0B] bg-white text-[#F59E0B]")}>
        {done ? "✓" : "!"}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-[#111827]">{label}</p>
        <p className="text-xs text-[#4B5563]">{value}</p>
      </div>
    </div>
  );
}
