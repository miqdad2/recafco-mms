import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/context";
import { canManageJobCardIndirectCostSetting } from "@/lib/security/permissions";
import { getJobCardIndirectCostSetting } from "@/lib/work-orders/job-card-indirect-cost";
import { updateJobCardIndirectCostSettingAction } from "@/app/actions/admin";

// Job Card Level Indirect Cost Correction Unit 10G.72B, Task 2, polished by
// Job Card Cost Setting Visibility Unit 10G.72C, Task 3, wording finalized by
// Job Card Indirect Cost Sidebar Visibility Unit 10G.72D, Task 5 — its own
// small settings sub-page, separate from the main /admin/settings page
// (which stays admin.settings.manage-only, Super Admin/IT Admin). Gated by
// canManageJobCardIndirectCostSetting instead, so Maintenance Manager can
// also reach and configure this one setting, matching this codebase's own
// existing precedent (admin/settings/asset-categories's own narrower
// assets.manage gate on a settings sub-page) rather than broadening the
// main Settings page's own access.

const ERROR_MESSAGES: Record<string, string> = {
  "permission-denied": "You do not have permission to manage this setting.",
  "invalid-input": "Invalid input. Indirect Cost must be 0 or greater.",
  "save-failed": "Could not save the setting. Please try again.",
};

export default async function JobCardIndirectCostSettingPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; success?: string }>;
}) {
  const context = await requireUser();
  // Unit 10G.72C, Task 3 — "Back" returns to wherever is actually reachable
  // for this viewer: Super Admin/IT Admin came from (or can freely reach)
  // /admin/settings; Maintenance Manager reaches this page from their own
  // Dashboard shortcut instead (Task 2) and cannot open /admin/settings at
  // all, so their own "Back" must not point at a page they'd be blocked
  // from.
  const isFullAdmin = context.role?.slug === "super_admin" || context.role?.slug === "it_admin";
  const backHref = isFullAdmin ? "/admin/settings" : "/dashboard";
  const backLabel = isFullAdmin ? "Back to Settings" : "Back to Dashboard";

  if (!canManageJobCardIndirectCostSetting(context)) {
    return (
      <>
        <PageHeader title="Job Card Indirect Cost Setting" />
        <div className="p-4 lg:p-6">
          <p className="text-sm text-[#6B7280]">You do not have permission to view this setting.</p>
        </div>
      </>
    );
  }

  const params = (await searchParams) ?? {};
  const errorMsg = params.error ? (ERROR_MESSAGES[params.error] ?? "An error occurred.") : null;
  const saved = params.success === "settings-saved";

  const setting = await getJobCardIndirectCostSetting();

  return (
    <>
      <PageHeader
        title="Job Card Indirect Cost Setting"
        description="Configure the one-time, Job-Card-wide Indirect Cost used in every Manager Closure Review cost summary."
        actions={
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {backLabel}
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        {errorMsg && (
          <div className="mb-4 max-w-xl rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3 text-sm font-semibold text-[#ED1C24]">
            {errorMsg}
          </div>
        )}
        {saved && (
          <div className="mb-4 max-w-xl rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
            Job Card Indirect Cost setting saved.
          </div>
        )}

        <form
          action={updateJobCardIndirectCostSettingAction}
          className="max-w-xl rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm"
        >
          <label className="block">
            <span className="text-sm font-semibold text-[#111827]">Indirect Cost per Job Card (KWD)</span>
            <input
              className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2"
              type="number"
              min="0"
              step="0.001"
              name="job_card_indirect_cost"
              defaultValue={setting.amount}
              required
            />
          </label>
          <p className="mt-2 text-xs text-[#6B7280]">
            This cost is added once to each Job Card cost summary during Closure Review. It is not per worker and
            not per hour.
          </p>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-[#111827]">
              Indirect Cost Note <span className="font-normal text-[#9CA3AF]">Optional</span>
            </span>
            <input
              className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2"
              type="text"
              maxLength={300}
              name="job_card_indirect_cost_note"
              defaultValue={setting.note ?? ""}
              placeholder="e.g. Covers tools, transport, PPE, overhead"
            />
          </label>

          {/* Unit 10G.72C, Task 3 — the exact formula example, so a Manager
              configuring this setting can see at a glance how it feeds into
              Closure Review's own Grand Total, without needing to open a
              Job Card first. */}
          <div className="mt-4 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-xs text-[#4B5563]">
            <p className="font-semibold text-[#111827]">Direct Labor Cost + Material Cost + Indirect Cost = Grand Total Job Cost</p>
            <p className="mt-1">This same formula is used in every Job Card&apos;s Closure Review.</p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button type="submit">Save Settings</Button>
            <Link
              href={backHref}
              className="inline-flex min-h-10 items-center rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
            >
              Back
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
