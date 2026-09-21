import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { updateSettingsAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function SettingsPage() {
  await requirePermission("admin.settings.manage");
  const settings = await prisma.app_settings.findUnique({
    where: { id: "00000000-0000-0000-0000-000000000001" }
  });

  return (
    <>
      <PageHeader title="Settings" description="Control RECAFCO company settings, numbering formats, currency, and approval thresholds." />
      <div className="p-4 lg:p-6">
        <form action={updateSettingsAction} className="max-w-4xl rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold">Company name</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="company_name" defaultValue={settings?.company_name ?? "RECAFCO"} required />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Default currency</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 uppercase" name="default_currency" defaultValue={settings?.default_currency ?? "KWD"} required />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Work order number format</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="work_order_number_format" defaultValue={settings?.work_order_number_format ?? "REC/MD/{TYPE}/JOB/{0000}"} required />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Parts request number format</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="parts_request_number_format" defaultValue={settings?.parts_request_number_format ?? "REC/STORE/PR/{0000}"} required />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Purchase request number format</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="purchase_request_number_format" defaultValue={settings?.purchase_request_number_format ?? "REC/PUR/{0000}"} required />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">CEO approval threshold</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" type="number" min="0" step="0.001" name="ceo_approval_threshold" defaultValue={settings ? settings.ceo_approval_threshold.toNumber() : 1000} required />
            </label>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-[#E5E7EB] p-3 text-sm font-semibold">
              <input type="checkbox" name="requester_confirmation_enabled" defaultChecked={settings?.requester_confirmation_enabled ?? true} /> Requester confirmation
            </label>
            <label className="flex items-center gap-2 rounded-md border border-[#E5E7EB] p-3 text-sm font-semibold">
              <input type="checkbox" name="finance_approval_enabled" defaultChecked={settings?.finance_approval_enabled ?? true} /> Finance approval
            </label>
            <label className="flex items-center gap-2 rounded-md border border-[#E5E7EB] p-3 text-sm font-semibold">
              <input type="checkbox" name="ceo_approval_enabled" defaultChecked={settings?.ceo_approval_enabled ?? true} /> CEO threshold approval
            </label>
          </div>
          <div className="mt-6 border-t border-[#E5E7EB] pt-5">
            <h2 className="text-lg font-black text-[#111827]">Operational Guardrails</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold">Max upload size (MB)</span>
                <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" type="number" min="1" max="100" name="max_upload_size_mb" defaultValue={settings?.max_upload_size_mb ?? 10} required />
              </label>
              <label className="block">
                <span className="text-sm font-semibold">Signed URL expiry (seconds)</span>
                <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" type="number" min="60" max="3600" name="signed_url_expiry_seconds" defaultValue={settings?.signed_url_expiry_seconds ?? 300} required />
              </label>
              <label className="block">
                <span className="text-sm font-semibold">Notification retention days</span>
                <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" type="number" min="30" max="3650" name="notification_retention_days" defaultValue={settings?.notification_retention_days ?? 180} required />
              </label>
              <label className="block">
                <span className="text-sm font-semibold">Notification poll interval seconds</span>
                <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" type="number" min="15" max="3600" name="notification_poll_interval_seconds" defaultValue={settings?.notification_poll_interval_seconds ?? 45} required />
              </label>
            </div>
            <label className="mt-4 flex items-center gap-2 rounded-md border border-[#E5E7EB] p-3 text-sm font-semibold">
              <input type="checkbox" name="force_critical_notifications" defaultChecked={settings?.force_critical_notifications ?? true} /> Force critical workflow notifications
            </label>
          </div>
          <Button type="submit" className="mt-5">
            Save settings
          </Button>
        </form>

        {/* Job Card Cost Setting Visibility Unit 10G.72C, Task 1, wording
            polished by Job Card Indirect Cost Sidebar Visibility Unit
            10G.72D, Task 4 — a plain link/card to the dedicated Job Card
            Indirect Cost setting sub-page (Unit 10G.72B), not the full
            editable form inlined here: that form is also reachable by
            Maintenance Manager via its own, narrower
            canManageJobCardIndirectCostSetting gate (10G.72D's own sidebar
            item and Dashboard shortcut), which does not extend to this page,
            so duplicating the editable inputs here would need its own
            separate permission carve-out inside an otherwise
            admin.settings.manage-only page — a plain card is enough and
            keeps this page's own gate completely unchanged. */}
        <div className="mt-5 max-w-4xl rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-[#111827]">Job Card Indirect Cost</h2>
          <p className="mt-1 text-sm text-[#4B5563]">
            Set the indirect cost added once to each Job Card during Closure Review.
          </p>
          <p className="mt-3 text-sm text-[#111827]">
            Indirect Cost per Job Card:{" "}
            <strong>{(settings ? settings.job_card_indirect_cost.toNumber() : 0).toFixed(3)} KWD</strong>
          </p>
          <Link
            href="/admin/settings/job-card-cost"
            className="focus-ring mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white hover:bg-[#c9151c]"
          >
            Open Indirect Cost Setting
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </>
  );
}
