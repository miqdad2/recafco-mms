import Link from "next/link";
import { Archive, CheckCheck, Search } from "lucide-react";

import { archiveNotificationAction, markAllNotificationsReadAction, markNotificationReadAction } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { getUserNotificationSummary, getUserNotifications } from "@/lib/notifications/service";
import { formatDateTime } from "@/lib/utils";

type NotificationsPageProps = {
  searchParams?: Promise<{
    status?: string;
    category?: string;
    priority?: string;
    search?: string;
  }>;
};

const categories = ["", "Work Orders", "Approvals", "Technician Jobs", "Parts Requests", "Store / Inventory", "Purchase", "Finance", "CEO / Management", "Assets", "Reports", "System"];
const priorities = ["", "low", "normal", "high", "urgent"];

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const context = await requirePermission("notifications.view");
  const params = await searchParams;
  const [notifications, summary] = await Promise.all([
    getUserNotifications(context.userId, {
      limit: 50,
      unreadOnly: params?.status === "unread",
      includeArchived: params?.status === "archived",
      category: params?.category || undefined,
      priority: params?.priority || undefined,
      search: params?.search || undefined
    }),
    getUserNotificationSummary(context.userId)
  ]);

  return (
    <>
      <PageHeader
        title="Notification Center"
        description="Review workflow alerts, approvals, assignments, and system messages."
        actions={
          <form action={markAllNotificationsReadAction}>
            <Button type="submit" variant="secondary">
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Mark all read
            </Button>
          </form>
        }
      />
      <div className="space-y-4 p-4 sm:p-6">
        <section className="grid gap-3 md:grid-cols-4">
          <SummaryCard label="Active" value={summary.active} detail="Visible workflow notifications" />
          <SummaryCard label="Unread" value={summary.unread} detail="Needs user attention" tone="red" />
          <SummaryCard label="High priority" value={summary.urgent} detail="High or urgent alerts" tone="amber" />
          <SummaryCard label="Archived" value={summary.archived} detail="Stored notification history" tone="gray" />
        </section>

        <form className="grid gap-3 rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm md:grid-cols-[1fr_12rem_10rem_9rem]">
          <label className="flex min-h-10 items-center gap-2 rounded-md border border-[#DDE2EA] px-3">
            <Search className="h-4 w-4 text-[#64748B]" aria-hidden="true" />
            <input name="search" defaultValue={params?.search ?? ""} className="w-full bg-transparent text-sm outline-none" placeholder="Search title or message" />
          </label>
          <select name="category" defaultValue={params?.category ?? ""} className="rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm font-semibold">
            {categories.map((category) => (
              <option key={category || "all"} value={category}>{category || "All categories"}</option>
            ))}
          </select>
          <select name="priority" defaultValue={params?.priority ?? ""} className="rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm font-semibold">
            {priorities.map((priority) => (
              <option key={priority || "all"} value={priority}>{priority || "All priorities"}</option>
            ))}
          </select>
          <select name="status" defaultValue={params?.status ?? ""} className="rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm font-semibold">
            <option value="">Active</option>
            <option value="unread">Unread</option>
            <option value="archived">Archived</option>
          </select>
          <div className="md:col-span-4">
            <Button type="submit" variant="secondary">Apply filters</Button>
          </div>
        </form>

        <section className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
          <div className="divide-y divide-[#EEF2F6]">
            {notifications.length ? (
              notifications.map((notification) => (
                <div key={notification.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-black text-[#111827]">{notification.title}</h2>
                      <StatusBadge label={notification.category} tone="blue" />
                      <StatusBadge label={notification.priority} tone={notification.priority === "urgent" || notification.priority === "high" ? "red" : notification.priority === "normal" ? "gray" : "green"} />
                      {!notification.read_at ? <StatusBadge label="Unread" tone="red" /> : <StatusBadge label="Read" tone="gray" />}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#4B5563]">{notification.message}</p>
                    <p className="mt-2 text-xs font-semibold text-[#64748B]">{formatDateTime(notification.created_at)}</p>
                    {notification.action_url ? (
                      <Link href={notification.action_url} className="mt-3 inline-flex text-sm font-bold text-[#ED1C24] hover:text-[#c9151c]">
                        {notification.action_label ?? "Open related record"}
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {!notification.read_at ? (
                      <form action={markNotificationReadAction}>
                        <input type="hidden" name="notification_id" value={notification.id} />
                        <Button type="submit" variant="secondary">Mark read</Button>
                      </form>
                    ) : null}
                    {!notification.archived_at ? (
                      <form action={archiveNotificationAction}>
                        <input type="hidden" name="notification_id" value={notification.id} />
                        <Button type="submit" variant="ghost">
                          <Archive className="h-4 w-4" aria-hidden="true" />
                          Archive
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center">
                <h2 className="text-lg font-black text-[#111827]">No notifications found</h2>
                <p className="mt-2 text-sm text-[#4B5563]">Try changing filters or wait for workflow activity.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function SummaryCard({ label, value, detail, tone = "blue" }: { label: string; value: number; detail: string; tone?: "blue" | "red" | "amber" | "gray" }) {
  const toneClass = {
    blue: "text-[#2563EB]",
    red: "text-[#ED1C24]",
    amber: "text-[#B45309]",
    gray: "text-[#111827]"
  }[tone];

  return (
    <div className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase text-[#4B5563]">{label}</p>
      <p className={`mt-2 text-3xl font-black ${toneClass}`}>{value.toLocaleString("en-US")}</p>
      <p className="mt-1 text-sm text-[#4B5563]">{detail}</p>
    </div>
  );
}
