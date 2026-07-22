import Link from "next/link";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import {
  LogOut,
} from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/layout/brand-logo";
import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { type NavIconKey } from "@/components/layout/nav-link";
import { CollapsibleNav, type CollapsibleNavGroup } from "@/components/layout/collapsible-nav";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationToastCenter } from "@/components/notifications/notification-toast-center";
import { ActionToast } from "@/components/ui/action-toast";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { initials } from "@/lib/utils";
import type { PermissionKey } from "@/types/database";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

const sidebarFont = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

type NavItem = {
  href: string;
  label: string;
  iconKey: NavIconKey;
  permission?: PermissionKey;
  superAdminOnly?: boolean;
};

type NavGroup = {
  label: string | null;
  items: NavItem[];
};

// ── CEO ────────────────────────────────────────────────────────────────────────

const ceoNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: "Executive",
    items: [
      { href: "/ceo/approvals",            label: "CEO Approvals",          iconKey: "Landmark",       permission: "ceo.approve" },
      { href: "/maintenance/work-orders",  label: "Executive Job Cards",    iconKey: "ClipboardList",  permission: "work_orders.view" },
      { href: "/assets",                   label: "Asset & Parts Risk",     iconKey: "Gauge",          permission: "assets.view" },
      { href: "/purchase/requests",        label: "Purchase",               iconKey: "ShoppingCart",   permission: "purchase_requests.view" },
      { href: "/reports",                  label: "Executive Reports",      iconKey: "BarChart3",      permission: "reports.view" },
      { href: "/notifications",            label: "Notifications",          iconKey: "Bell",           permission: "notifications.view" }
    ]
  }
];

// ── Super Admin ────────────────────────────────────────────────────────────────

const navigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: null,
    items: [
      { href: "/maintenance/work-orders",  label: "Job Cards",                 iconKey: "ClipboardList", permission: "work_orders.view" },
      { href: "/store/parts-requests",     label: "Materials Requests",        iconKey: "ShoppingCart",  permission: "parts_requests.view" },
      { href: "/store/offline-inventory",  label: "Offline Inventory Control", iconKey: "ArrowDownUp",   permission: "parts.view" },
      { href: "/assets/service-contracts", label: "Service Contracts",         iconKey: "FileText",      permission: "assets.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/assets",                        label: "Assets & Equipment", iconKey: "Gauge",      permission: "assets.view" },
      { href: "/maintenance/assignments",        label: "Technician",          iconKey: "Wrench",     permission: "work_orders.assign" },
      { href: "/reports",                       label: "Reports",             iconKey: "BarChart3",  permission: "reports.view" },
      { href: "/notifications",                 label: "Notifications",       iconKey: "Bell",       permission: "notifications.view" },
      { href: "/admin/users",                   label: "Users",               iconKey: "Users",      permission: "admin.users.manage" },
      { href: "/admin/settings",                label: "Settings",            iconKey: "Settings",   permission: "admin.settings.manage" },
      { href: "/admin/settings/asset-categories", label: "Asset Categories", iconKey: "Layers",     permission: "assets.manage" },
      { href: "/admin/audit-logs",              label: "Audit Logs",          iconKey: "Activity",   permission: "admin.audit_logs.view" },
      { href: "/admin/system-health",           label: "System Health",       iconKey: "HeartPulse", permission: "admin.system_health.view" }
    ]
  }
];

// ── Maintenance Manager ────────────────────────────────────────────────────────

const maintenanceManagerNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: null,
    items: [
      { href: "/maintenance/work-orders",  label: "Job Cards",                 iconKey: "ClipboardList", permission: "work_orders.view" },
      { href: "/store/parts-requests",     label: "Materials Requests",        iconKey: "ShoppingCart",  permission: "parts_requests.view" },
      { href: "/store/offline-inventory",  label: "Offline Inventory Control", iconKey: "ArrowDownUp",   permission: "parts.view" },
      { href: "/assets/service-contracts", label: "Service Contracts",         iconKey: "FileText",      permission: "assets.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/assets",                  label: "Assets & Equipment", iconKey: "Gauge",     permission: "assets.view" },
      { href: "/maintenance/assignments", label: "Technician",          iconKey: "Wrench",    permission: "work_orders.assign" },
      { href: "/reports",                 label: "Reports",             iconKey: "BarChart3", permission: "reports.view" },
      { href: "/notifications",           label: "Notifications",       iconKey: "Bell",      permission: "notifications.view" }
    ]
  }
];

// ── Store Keeper ───────────────────────────────────────────────────────────────
// Store Issue Materials + Offline Inventory Separation Unit Task 2: Offline
// Inventory Control (the general balance/ledger page) is no longer Store's
// primary work page — replaced with Issue Materials (approved requests ready
// to send) and Sent Materials (the existing movement history page, relabeled
// for Store's own record-keeping). The route itself is untouched and still
// reachable directly; it's just no longer advertised as Store's main page.

const storeKeeperNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: null,
    items: [
      { href: "/store/parts-requests",              label: "Materials Requests", iconKey: "ShoppingCart", permission: "store.issue" },
      { href: "/store/issue-materials",              label: "Send Materials",     iconKey: "ArrowDownUp", permission: "store.issue" },
      { href: "/store/offline-inventory/movements",  label: "Sent Materials",     iconKey: "Activity", permission: "parts.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/notifications", label: "Notifications", iconKey: "Bell",    permission: "notifications.view" }
    ]
  }
];

// ── Technician ─────────────────────────────────────────────────────────────────
// Technician Dashboard and My Jobs Workflow Alignment Unit Task 2: the
// generic "Job Cards" link (/maintenance/work-orders — the office/desk list
// with KPI cards, tabs, and filters built for Manager/Engineer/Data Entry)
// was dropped in favor of the one mobile-friendly job list Technician
// actually needs, renamed from "Technician" to "My Jobs" since the old label
// just duplicated the role name without saying what the link does.
//
// Technician Materials Request Access Cleanup: the standalone "Materials
// Requests" nav entry (the full company-wide queue at /store/parts-requests)
// was removed too — it's built for Data Entry/Engineer/Manager/Store, not a
// technician in the field. Technician still requests extra materials, but
// only from inside an assigned/in-progress Job Card (the embedded "Request
// Extra Materials" form on /technician/jobs/[id]), never from a standalone
// list page. Data Entry/Engineer/Manager/Store's own nav arrays are
// untouched.

const technicianNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/technician/jobs", label: "My Jobs",       iconKey: "Wrench", permission: "technician.jobs.view" },
      { href: "/notifications",   label: "Notifications", iconKey: "Bell",   permission: "notifications.view" }
    ]
  }
];

// ── Maintenance Engineer ─────────────────────────────────────────────────────

// Sidebar Access Alignment Task 2/3: Offline Inventory Control (read-only —
// the page itself gates every write action behind store.issue, which
// Engineer doesn't hold) and Technician (operational tracking of assigned/
// in-progress/closed work — /maintenance/assignments, gated on
// work_orders.assign, which Engineer already holds) were both simply absent
// from this role's nav groups, unlike the earlier Dashboard/Assets/Reports
// gap which was a missing permission grant, not a missing nav entry.
const maintenanceEngineerNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: null,
    items: [
      { href: "/maintenance/work-orders",  label: "Job Cards",                 iconKey: "ClipboardList", permission: "work_orders.view" },
      { href: "/store/parts-requests",     label: "Materials Requests",        iconKey: "ShoppingCart",  permission: "parts_requests.view" },
      { href: "/store/offline-inventory",  label: "Offline Inventory Control", iconKey: "ArrowDownUp",   permission: "parts.view" },
      { href: "/assets/service-contracts", label: "Service Contracts",         iconKey: "FileText",      permission: "assets.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/assets",                  label: "Assets & Equipment", iconKey: "Gauge",     permission: "assets.view" },
      { href: "/maintenance/assignments", label: "Technician",          iconKey: "Wrench",    permission: "work_orders.assign" },
      { href: "/reports",                 label: "Reports",             iconKey: "BarChart3", permission: "reports.view" },
      { href: "/notifications",           label: "Notifications",       iconKey: "Bell",      permission: "notifications.view" }
    ]
  }
];

// ── Viewer / Auditor ─────────────────────────────────────────────────────────
// Read-only role — every link below is gated by a view-only permission
// (assets.view, work_orders.view, parts_requests.view, reports.view), so no
// create/edit/approve entry point is ever exposed even if this group's items
// were somehow reused elsewhere.

const viewerAuditorNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: null,
    items: [
      { href: "/maintenance/work-orders", label: "Job Cards",          iconKey: "ClipboardList", permission: "work_orders.view" },
      { href: "/store/parts-requests",    label: "Materials Requests", iconKey: "ShoppingCart",  permission: "parts_requests.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/assets",        label: "Assets & Equipment", iconKey: "Gauge",     permission: "assets.view" },
      { href: "/reports",       label: "Reports",             iconKey: "BarChart3", permission: "reports.view" },
      { href: "/notifications", label: "Notifications",       iconKey: "Bell",      permission: "notifications.view" }
    ]
  }
];

// ── Normal User (Maintenance Data Entry / Department Requester) ────────────────

// Sidebar Access Alignment Task 3: Technician (/maintenance/assignments,
// gated on work_orders.assign, which Data Entry already holds) was missing
// from this role's nav — Data Entry needs it to follow up on assignment
// after materials are issued, same as Engineer/Manager.
const normalUserNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: null,
    items: [
      { href: "/maintenance/work-orders",  label: "Job Cards",                 iconKey: "ClipboardList", permission: "work_orders.view" },
      { href: "/store/parts-requests",     label: "Materials Requests",        iconKey: "ShoppingCart",  permission: "parts_requests.view" },
      { href: "/store/offline-inventory",  label: "Offline Inventory Control", iconKey: "ArrowDownUp",   permission: "parts.view" },
      { href: "/assets/service-contracts", label: "Service Contracts",         iconKey: "FileText",      permission: "assets.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/assets",                  label: "Assets & Equipment", iconKey: "Gauge",     permission: "assets.view" },
      { href: "/maintenance/assignments", label: "Technician",          iconKey: "Wrench",    permission: "work_orders.assign" },
      { href: "/reports",                 label: "Reports",             iconKey: "BarChart3", permission: "reports.view" },
      { href: "/notifications",           label: "Notifications",       iconKey: "Bell",      permission: "notifications.view" }
    ]
  }
];

// ── Permission filter ──────────────────────────────────────────────────────────

function canSee(context: CurrentUserContext, item: NavItem) {
  if (item.superAdminOnly) return context.role?.slug === "super_admin";
  const permission = item.permission;
  return !permission || context.role?.slug === "super_admin" || context.permissions.includes(permission);
}

// ── Layout ─────────────────────────────────────────────────────────────────────

export async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await requireUser();

  const roleSlug = context.role?.slug;
  const isCeo = roleSlug === "ceo_management";
  const isSuperAdmin = roleSlug === "super_admin";
  const isMaintenanceManager = roleSlug === "maintenance_manager";
  const isMaintenanceEngineer = roleSlug === "maintenance_engineer";
  const isStoreKeeper = roleSlug === "store_keeper";
  const isTechnician = roleSlug === "technician";
  const isViewerAuditor = roleSlug === "viewer_auditor";

  // Feature-flag-gated nav injection for Store Keeper: Inventory Check link
  let activeStoreKeeperGroups = storeKeeperNavigationGroups;
  if (isStoreKeeper) {
    const sk = await prisma.app_settings
      .findUnique({ where: { id: SETTINGS_ID }, select: { inventory_check_enabled: true } })
      .catch(() => null);
    if (sk?.inventory_check_enabled) {
      activeStoreKeeperGroups = [
        storeKeeperNavigationGroups[0],
        {
          label: null,
          items: [
            {
              href: "/store/inventory-check",
              label: "Inventory Check",
              iconKey: "ClipboardCheck" as NavIconKey,
              permission: "store.issue" as PermissionKey
            },
            ...storeKeeperNavigationGroups[1].items
          ]
        },
        storeKeeperNavigationGroups[2]
      ];
    }
  }

  const groups = isCeo ? ceoNavigationGroups
    : isMaintenanceManager ? maintenanceManagerNavigationGroups
    : isMaintenanceEngineer ? maintenanceEngineerNavigationGroups
    : isStoreKeeper ? activeStoreKeeperGroups
    : isTechnician ? technicianNavigationGroups
    : isViewerAuditor ? viewerAuditorNavigationGroups
    : isSuperAdmin ? navigationGroups
    : normalUserNavigationGroups;

  const visibleGroups: CollapsibleNavGroup[] = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => canSee(context, item)) }))
    .filter((group) => group.items.length > 0);

  const allVisibleItems = visibleGroups.flatMap((g) => g.items);

  return (
    <div className="min-h-screen overflow-x-clip bg-[#F3F5F8] pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <aside
        className={`${sidebarFont.className} fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/10 bg-[#081225] text-[#E8EDF5] lg:flex`}
      >
        <div className="flex flex-none items-center gap-3 border-b border-white/10 px-4 py-4">
          <BrandLogo variant="dark" size="sm" subtitle="Maintenance & Asset Management" />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          <CollapsibleNav groups={visibleGroups} />
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-[#DDE2EA] bg-white/95 px-3 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase text-[#4B5563] sm:text-xs">Maintenance Department System</p>
            <p className="truncate text-sm font-semibold text-[#111827]">{context.department?.name ?? "No department assigned"}</p>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="hidden sm:block">
              <StatusBadge label={context.role?.name ?? "No role"} tone="blue" />
            </div>
            <NotificationBell userId={context.userId} />
            <Link href="/profile" className="hidden items-center gap-2 sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#2B2B2B] text-sm font-bold text-white">
                {initials(context.profile.full_name)}
              </span>
              <span className="max-w-48 truncate text-sm font-semibold text-[#111827]">{context.profile.full_name}</span>
            </Link>
            <Link href="/profile" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#2B2B2B] text-sm font-bold text-white sm:hidden" aria-label="Open profile">
              {initials(context.profile.full_name)}
            </Link>
            <form action={signOutAction}>
              <Button variant="secondary" className="px-3" title="Logout">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </form>
          </div>
        </header>
        <main className="min-w-0">{children}</main>
      </div>
      <Suspense fallback={null}>
        <ActionToast />
      </Suspense>
      <NotificationToastCenter userId={context.userId} />
      <MobileNavigation items={allVisibleItems.map(({ href, label, iconKey }) => ({ href, label, iconKey }))} />
    </div>
  );
}
