import { updateNotificationPreferencesAction } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { getNotificationPreferences } from "@/lib/notifications/preferences";

export default async function NotificationPreferencesPage() {
  const context = await requireUser();
  const [events, preferences] = await Promise.all([
    prisma.notification_events.findMany({
      select: {
        event_key: true,
        category: true,
        priority: true,
        description: true,
        is_critical: true
      },
      orderBy: [{ category: "asc" }, { event_key: "asc" }]
    }),
    getNotificationPreferences(context.userId)
  ]);
  const disabled = new Set(preferences.filter((preference) => !preference.in_app_enabled).map((preference) => preference.event_key));

  return (
    <>
      <PageHeader title="Notification Preferences" description="Control in-app notifications. Email, WhatsApp, SMS, and push are prepared for future rollout." />
      <div className="p-4 sm:p-6">
        <form action={updateNotificationPreferencesAction} className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
          <div className="divide-y divide-[#EEF2F6]">
            {(events ?? []).map((event) => (
              <div key={event.event_key} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
                <input type="hidden" name="event_key" value={event.event_key} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-black text-[#111827]">{event.event_key}</h2>
                    <StatusBadge label={event.category} tone="blue" />
                    <StatusBadge label={event.priority} tone={event.priority === "urgent" || event.priority === "high" ? "red" : "gray"} />
                    {event.is_critical ? <StatusBadge label="Critical" tone="red" /> : null}
                  </div>
                  <p className="mt-2 text-sm text-[#4B5563]">{event.description}</p>
                  <p className="mt-2 text-xs font-semibold text-[#64748B]">External channels: Email, WhatsApp, SMS, and push are disabled for this phase.</p>
                </div>
                <label className="flex items-center gap-2 text-sm font-bold text-[#111827]">
                  <input type="checkbox" name="disabled_event_key" value={event.event_key} defaultChecked={disabled.has(event.event_key)} disabled={event.is_critical} />
                  Disable in-app
                </label>
              </div>
            ))}
          </div>
          <div className="border-t border-[#DDE2EA] p-4">
            <Button type="submit">Save preferences</Button>
          </div>
        </form>
      </div>
    </>
  );
}
