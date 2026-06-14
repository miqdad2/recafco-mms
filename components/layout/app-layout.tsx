import Link from "next/link";
import { Suspense } from "react";
import {
  LogOut,
} from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/layout/brand-logo";
import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { NavLink, type NavIconKey } from "@/components/layout/nav-link";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ActionToast } from "@/components/ui/action-toast";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { initials } from "@/lib/utils";
import type { PermissionKey } from "@/types/database";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

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
      { href: "/maintenance/work-orders",  label: "Executive Work Orders",  iconKey: "ClipboardList",  permission: "work_orders.view" },
      { href: "/assets",                   label: "Asset & Parts Risk",     iconKey: "Gauge",          permission: "assets.view" },
      { href: "/purchase/requests",        label: "Purchase",               iconKey: "ShoppingCart",   permission: "purchase_requests.view" },
      { href: "/reports/work-orders",      label: "Executive Reports",      iconKey: "BarChart3",      permission: "reports.view" },
      { href: "/notifications",            label: "Notifications",          iconKey: "Bell",           permission: "notifications.view" }
    ]
  }
];

const maintenanceManagerNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: "Maintenance",
    items: [
      { href: "/maintenance/work-orders", label: "Work Orders",    iconKey: "ClipboardList",  permission: "work_orders.view" },
      { href: "/maintenance/approvals",   label: "Approvals",      iconKey: "ClipboardCheck", permission: "work_orders.approve" },
      { href: "/maintenance/assignments", label: "Assignments",    iconKey: "Users",          permission: "work_orders.assign" }
    ]
  },
  {
    label: "Assets & Inventory",
    items: [
      { href: "/assets",               label: "Asset Register",    iconKey: "Gauge",        permission: "assets.view" },
      { href: "/store/parts",          label: "Spare Parts Stock", iconKey: "Package",      permission: "parts.view" },
      { href: "/store/parts-requests", label: "Parts Requests",    iconKey: "ClipboardList", permission: "parts_requests.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/purchase/requests",    label: "Purchase",       iconKey: "ShoppingCart", permission: "purchase_requests.view" },
      { href: "/reports/work-orders",  label: "Reports",        iconKey: "BarChart3",    permission: "reports.view" },
      { href: "/notifications",        label: "Notifications",  iconKey: "Bell",         permission: "notifications.view" }
    ]
  }
];

const storeKeeperNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: "Stock Management",
    items: [
      { href: "/store/parts",               label: "Spare Parts Stock",   iconKey: "Package",       permission: "parts.view" },
      { href: "/store/parts-requests",      label: "Parts Requests",      iconKey: "ClipboardList", permission: "parts_requests.view" },
      { href: "/store/inventory-movements", label: "Stock Movements",     iconKey: "Activity",      permission: "inventory.movements.view" },
      { href: "/store/parts?status=Low+Stock", label: "Low Stock Alert",  iconKey: "TriangleAlert", permission: "parts.view" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/notifications", label: "Notifications", iconKey: "Bell", permission: "notifications.view" }
    ]
  }
];

const dataEntryNavigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: "My Work",
    items: [
      { href: "/maintenance/work-orders/new", label: "Create Request", iconKey: "PlusCircle", permission: "work_orders.manage" },
      { href: "/maintenance/work-orders", label: "My Requests", iconKey: "ClipboardList", permission: "work_orders.view" },
      { href: "/maintenance/work-orders?status=Draft", label: "Drafts", iconKey: "FileText" },
      { href: "/maintenance/work-orders?status=Rejected", label: "Rejected / Fix", iconKey: "RotateCcw" },
      { href: "/assets", label: "Assets", iconKey: "Gauge", permission: "assets.view" },
      { href: "/notifications", label: "Notifications", iconKey: "Bell", permission: "notifications.view" }
    ]
  }
];

const navigationGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", iconKey: "LayoutDashboard", permission: "dashboard.view" }
    ]
  },
  {
    label: "Business Operations",
    items: [
      { href: "/maintenance/work-orders", label: "Work Orders", iconKey: "ClipboardList", permission: "work_orders.view" },
      { href: "/maintenance/approvals", label: "Approvals", iconKey: "ClipboardCheck", permission: "work_orders.approve" },
      { href: "/ceo/approvals", label: "CEO Approvals", iconKey: "Landmark", permission: "ceo.approve" },
      { href: "/maintenance/assignments", label: "Assignments", iconKey: "Users", permission: "work_orders.assign" },
      { href: "/technician/jobs", label: "My Jobs", iconKey: "Wrench", permission: "technician.jobs.view" },
      { href: "/assets", label: "Assets", iconKey: "Gauge", permission: "assets.view" },
      { href: "/store/parts", label: "Spare Parts", iconKey: "Package", permission: "parts.view" },
      { href: "/store/parts-requests", label: "Parts Requests", iconKey: "ClipboardList", permission: "parts_requests.view" },
      { href: "/store/inventory-movements", label: "Inventory Moves", iconKey: "Activity", permission: "inventory.movements.view" },
      { href: "/purchase/requests", label: "Purchase", iconKey: "ShoppingCart", permission: "purchase_requests.view" },
      { href: "/finance/approvals", label: "Finance", iconKey: "Landmark", permission: "finance.approve" },
      { href: "/reports/work-orders", label: "Reports", iconKey: "BarChart3", permission: "reports.view" }
    ]
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users", iconKey: "Users", permission: "admin.users.manage" },
      { href: "/admin/roles", label: "Roles", iconKey: "ShieldCheck", permission: "admin.roles.view" },
      { href: "/admin/departments", label: "Departments", iconKey: "Building2", permission: "admin.departments.manage" },
      { href: "/notifications", label: "Notifications", iconKey: "Bell", permission: "notifications.view" },
      { href: "/admin/notification-settings", label: "Notification Settings", iconKey: "BellDot", permission: "admin.notification_settings.manage" },
      { href: "/admin/settings", label: "Settings", iconKey: "Settings", permission: "admin.settings.manage" },
      { href: "/admin/audit-logs", label: "Audit Logs", iconKey: "Activity", permission: "admin.audit_logs.view" }
    ]
  },
  {
    label: "System Control",
    items: [
      { href: "/admin/system-health", label: "System Health", iconKey: "HeartPulse", permission: "admin.system_health.view" },
      { href: "/admin/architecture", label: "Architecture", iconKey: "Network", permission: "architecture.view" },
      { href: "/admin/system-map", label: "System Map", iconKey: "Map", permission: "system_map.view" },
      { href: "/admin/system-map/edit", label: "Map Editor", iconKey: "Pencil", superAdminOnly: true },
      { href: "/admin/demo-guide", label: "Demo Guide", iconKey: "BookOpen", superAdminOnly: true }
    ]
  }
];

function canSee(context: CurrentUserContext, item: NavItem) {
  if (item.superAdminOnly) return context.role?.slug === "super_admin";
  const permission = item.permission;
  return !permission || context.role?.slug === "super_admin" || context.permissions.includes(permission);
}

export async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await requireUser();

  const roleSlug = context.role?.slug;
  const isCeo = roleSlug === "ceo_management";
  const isDataEntry = roleSlug === "maintenance_data_entry";
  const isMaintenanceManager = roleSlug === "maintenance_manager";
  const isStoreKeeper = roleSlug === "store_keeper";

  // Feature-flag-gated nav injection for Store Keeper: add Inventory Check link
  // only when app_settings.inventory_check_enabled = true.
  let activeStoreKeeperGroups = storeKeeperNavigationGroups;
  if (isStoreKeeper) {
    const sk = await prisma.app_settings
      .findUnique({ where: { id: SETTINGS_ID }, select: { inventory_check_enabled: true } })
      .catch(() => null);
    if (sk?.inventory_check_enabled) {
      activeStoreKeeperGroups = [
        storeKeeperNavigationGroups[0],
        {
          label: "Stock Management",
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
    : isDataEntry ? dataEntryNavigationGroups
    : isMaintenanceManager ? maintenanceManagerNavigationGroups
    : isStoreKeeper ? activeStoreKeeperGroups
    : navigationGroups;

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => canSee(context, item)) }))
    .filter((group) => group.items.length > 0);

  const allVisibleItems = visibleGroups.flatMap((g) => g.items);

  return (
    <div className="min-h-screen overflow-x-clip bg-[#F3F5F8] pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-black/20 bg-[#111827] text-white lg:flex">
        <div className="flex flex-none items-center gap-3 border-b border-white/10 px-4 py-4">
          <BrandLogo variant="dark" size="sm" subtitle="Maintenance System" />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main navigation">
          {visibleGroups.map((group, idx) => (
            <div key={group.label ?? "__main__"} className={idx > 0 ? "mt-6" : ""}>
              {group.label ? (
                <p className="mb-2 px-3 pt-1 text-[10px] font-black uppercase tracking-widest text-gray-500 select-none">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} iconKey={item.iconKey} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-[#DDE2EA] bg-white/95 px-3 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase text-[#4B5563] sm:text-xs">Internal Enterprise System</p>
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
      <MobileNavigation items={allVisibleItems.map(({ href, label, iconKey }) => ({ href, label, iconKey }))} />
    </div>
  );
}
