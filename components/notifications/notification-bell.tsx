import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";

import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/actions/notifications";
import { NotificationLiveCount } from "@/components/notifications/notification-live-count";
import { Button } from "@/components/ui/button";
import { getUnreadNotificationCount, getUserNotifications } from "@/lib/notifications/service";
import { formatDateTime } from "@/lib/utils";

export async function NotificationBell({ userId }: { userId: string }) {
  const [unreadCount, notifications] = await Promise.all([
    getUnreadNotificationCount(userId),
    getUserNotifications(userId, { limit: 10 })
  ]);

  return (
    <div className="group relative">
      <Link
        href="/notifications"
        className="focus-ring relative flex h-10 w-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F8FAFC]"
        aria-label={`Open notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {/* NotificationLiveCount renders the badge server-side with initialCount,
            then connects to SSE after hydration for real-time badge updates. */}
        <NotificationLiveCount userId={userId} initialCount={unreadCount} />
      </Link>

      <div className="invisible absolute right-0 top-11 z-30 hidden w-[min(24rem,calc(100vw-2rem))] rounded-md border border-[#DDE2EA] bg-white opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 sm:block">
        <div className="flex items-center justify-between gap-3 border-b border-[#EEF2F6] p-3">
          <div>
            <p className="text-sm font-black text-[#111827]">Notifications</p>
            <p className="text-xs font-semibold text-[#64748B]">{unreadCount} unread</p>
          </div>
          <form action={markAllNotificationsReadAction}>
            <Button variant="ghost" className="min-h-8 px-2 text-xs">
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Mark all
            </Button>
          </form>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length ? (
            notifications.map((notification) => (
              <div key={notification.id} className="border-b border-[#EEF2F6] p-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[#111827]">{notification.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#4B5563]">{notification.message}</p>
                    <p className="mt-1 text-[11px] font-semibold text-[#64748B]">{formatDateTime(notification.created_at)}</p>
                  </div>
                  {!notification.read_at ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notification_id" value={notification.id} />
                      <Button variant="ghost" className="min-h-8 px-2 text-xs">Read</Button>
                    </form>
                  ) : null}
                </div>
                {notification.action_url ? (
                  <Link href={notification.action_url} className="mt-2 inline-flex text-xs font-bold text-[#ED1C24] hover:text-[#c9151c]">
                    {notification.action_label ?? "Open"}
                  </Link>
                ) : null}
              </div>
            ))
          ) : (
            <p className="p-4 text-sm text-[#4B5563]">No notifications.</p>
          )}
        </div>
        <Link href="/notifications" className="block border-t border-[#EEF2F6] p-3 text-center text-sm font-bold text-[#ED1C24] hover:bg-[#F8FAFC]">
          Open notification center
        </Link>
      </div>
    </div>
  );
}
