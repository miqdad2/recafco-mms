import { updateNotificationEventAction } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";

export default async function AdminNotificationSettingsPage() {
  await requirePermission("admin.notification_settings.manage");
  const [events, templates, logs, recentNotifications] = await Promise.all([
    prisma.notification_events.findMany({
      orderBy: [{ category: "asc" }, { event_key: "asc" }]
    }),
    prisma.notification_templates.findMany({
      where: { channel: "in_app" },
      orderBy: { event_key: "asc" }
    }),
    prisma.notification_delivery_logs.findMany({
      orderBy: { attempted_at: "desc" },
      take: 20
    }),
    prisma.notifications.findMany({
      select: { id: true, title: true, category: true, priority: true, created_at: true },
      orderBy: { created_at: "desc" },
      take: 10
    })
  ]);
  const templateByEvent = new Map((templates ?? []).map((template) => [template.event_key, template]));

  return (
    <>
      <PageHeader title="Notification Settings" description="Manage notification events, simple in-app templates, delivery logs, and recent system notifications." />
      <div className="space-y-6 p-4 sm:p-6">
        <section className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
          <div className="border-b border-[#DDE2EA] p-4">
            <h2 className="text-lg font-black text-[#111827]">Events and Templates</h2>
          </div>
          <div className="divide-y divide-[#EEF2F6]">
            {(events ?? []).map((event) => {
              const template = templateByEvent.get(event.event_key);
              return (
                <form key={event.event_key} action={updateNotificationEventAction} className="grid gap-3 p-4 xl:grid-cols-[1fr_18rem_22rem_auto]">
                  <input type="hidden" name="event_key" value={event.event_key} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-[#111827]">{event.event_key}</p>
                      <StatusBadge label={event.category} tone="blue" />
                      <StatusBadge label={event.priority} tone={event.priority === "urgent" || event.priority === "high" ? "red" : "gray"} />
                      {event.is_critical ? <StatusBadge label="Critical" tone="red" /> : null}
                    </div>
                    <p className="mt-1 text-sm text-[#4B5563]">{event.description}</p>
                  </div>
                  <input name="title_template" defaultValue={template?.title_template ?? ""} className="rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" placeholder="Title template" />
                  <input name="message_template" defaultValue={template?.message_template ?? ""} className="rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" placeholder="Message template" />
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm font-bold">
                      <input type="checkbox" name="is_enabled" defaultChecked={event.is_enabled} disabled={event.is_critical} />
                      Enabled
                    </label>
                    <Button type="submit" variant="secondary">Save</Button>
                  </div>
                </form>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
            <div className="border-b border-[#DDE2EA] p-4">
              <h2 className="text-lg font-black text-[#111827]">Delivery Logs</h2>
            </div>
            <div className="divide-y divide-[#EEF2F6]">
              {(logs ?? []).map((log) => (
                <div key={log.id} className="p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold text-[#111827]">{log.event_key ?? "Unknown event"}</p>
                    <StatusBadge label={log.status} tone={log.status === "failed" ? "red" : log.status === "sent" ? "green" : "gray"} />
                  </div>
                  <p className="mt-1 text-[#64748B]">{formatDateTime(log.attempted_at.toISOString())}</p>
                  {log.error_message ? <p className="mt-1 text-red-700">{log.error_message}</p> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
            <div className="border-b border-[#DDE2EA] p-4">
              <h2 className="text-lg font-black text-[#111827]">Recent System Notifications</h2>
            </div>
            <div className="divide-y divide-[#EEF2F6]">
              {(recentNotifications ?? []).map((notification) => (
                <div key={notification.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-[#111827]">{notification.title}</p>
                    <StatusBadge label={notification.category} tone="blue" />
                    <StatusBadge label={notification.priority} tone={notification.priority === "urgent" || notification.priority === "high" ? "red" : "gray"} />
                  </div>
                  <p className="mt-1 text-sm text-[#64748B]">{formatDateTime(notification.created_at.toISOString())}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
