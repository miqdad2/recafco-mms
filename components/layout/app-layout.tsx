import Link from "next/link";
import {
  Activity,
  BarChart3,
  Building2,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  LogOut,
  Package,
  Bell,
  BookOpen,
  Wrench,
  ShoppingCart,
  Landmark,
  Map,
  Settings,
  ShieldCheck,
  Users
} from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/layout/brand-logo";
import { NavLink, type NavIconKey } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import { initials } from "@/lib/utils";
import type { PermissionKey } from "@/types/database";

const navigation: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  iconKey: NavIconKey;
  permission?: PermissionKey;
  superAdminOnly?: boolean;
}> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, iconKey: "LayoutDashboard", permission: "dashboard.view" },
  { href: "/admin/users", label: "Users", icon: Users, iconKey: "Users", permission: "admin.users.manage" },
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck, iconKey: "ShieldCheck", permission: "admin.roles.view" },
  { href: "/admin/departments", label: "Departments", icon: Building2, iconKey: "Building2", permission: "admin.departments.manage" },
  { href: "/admin/settings", label: "Settings", icon: Settings, iconKey: "Settings", permission: "admin.settings.manage" },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: Activity, iconKey: "Activity", permission: "admin.audit_logs.view" },
  { href: "/admin/system-map", label: "System Map", icon: Map, iconKey: "Map", permission: "system_map.view" },
  { href: "/admin/demo-guide", label: "Demo Guide", icon: BookOpen, iconKey: "BookOpen", superAdminOnly: true },
  { href: "/maintenance/work-orders", label: "Work Orders", icon: ClipboardList, iconKey: "ClipboardList", permission: "work_orders.view" },
  { href: "/maintenance/approvals", label: "Approvals", icon: Bell, iconKey: "Bell", permission: "work_orders.approve" },
  { href: "/maintenance/assignments", label: "Assignments", icon: Users, iconKey: "Users", permission: "work_orders.assign" },
  { href: "/technician/jobs", label: "My Jobs", icon: Wrench, iconKey: "Wrench", permission: "technician.jobs.view" },
  { href: "/assets", label: "Assets", icon: Gauge, iconKey: "Gauge", permission: "assets.view" },
  { href: "/store/parts", label: "Spare Parts", icon: Package, iconKey: "Package", permission: "parts.view" },
  { href: "/store/parts-requests", label: "Parts Requests", icon: ClipboardList, iconKey: "ClipboardList", permission: "parts_requests.view" },
  { href: "/store/inventory-movements", label: "Inventory Moves", icon: Activity, iconKey: "Activity", permission: "inventory.movements.view" },
  { href: "/purchase/requests", label: "Purchase", icon: ShoppingCart, iconKey: "ShoppingCart", permission: "purchase_requests.view" },
  { href: "/finance/approvals", label: "Finance", icon: Landmark, iconKey: "Landmark", permission: "finance.approve" }
  ,
  { href: "/reports/work-orders", label: "Reports", icon: BarChart3, iconKey: "BarChart3", permission: "reports.view" }
];

function canSee(context: CurrentUserContext, item: (typeof navigation)[number]) {
  if (item.superAdminOnly) return context.role?.slug === "super_admin";
  const permission = item.permission;
  return !permission || context.role?.slug === "super_admin" || context.permissions.includes(permission);
}

export async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await requireUser();
  const visibleNavigation = navigation.filter((item) => canSee(context, item));
  const mobileNavigation = visibleNavigation.slice(0, 5);

  return (
    <div className="min-h-screen bg-[#F3F5F8] pb-20 lg:pb-0">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-black/20 bg-[#111827] text-white lg:block">
        <div className="flex h-24 items-center border-b border-white/10 px-4">
          <BrandLogo variant="dark" size="sm" />
        </div>
        <nav className="h-[calc(100vh-6rem)] space-y-1 overflow-y-auto px-3 py-4">
          {visibleNavigation.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} icon={item.iconKey} />
          ))}
        </nav>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-[#DDE2EA] bg-white/95 px-4 backdrop-blur sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase text-[#4B5563]">Internal Enterprise System</p>
            <p className="text-sm font-semibold text-[#111827]">{context.department?.name ?? "No department assigned"}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge label={context.role?.name ?? "No role"} tone="blue" />
            <Link href="/profile" className="hidden items-center gap-2 sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#2B2B2B] text-sm font-bold text-white">
                {initials(context.profile.full_name)}
              </span>
              <span className="text-sm font-semibold text-[#111827]">{context.profile.full_name}</span>
            </Link>
            <form action={signOutAction}>
              <Button variant="secondary" className="px-3" title="Logout">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </form>
          </div>
        </header>
        <main>{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[#E5E7EB] bg-white shadow-lg lg:hidden">
        {mobileNavigation.map((item) => (
          <Link key={item.href} href={item.href} className="flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold text-[#4B5563]">
            <item.icon className="h-4 w-4" aria-hidden="true" />
            <span className="max-w-full truncate px-1">{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
