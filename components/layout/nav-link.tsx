"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpFromLine,
  BarChart3,
  Bell,
  BellDot,
  BookOpen,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gauge,
  HeartPulse,
  Landmark,
  Layers,
  LayoutDashboard,
  Map,
  Network,
  Package,
  PackagePlus,
  Pencil,
  PlusCircle,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
  Upload,
  Users,
  Wrench
} from "lucide-react";

import { cn } from "@/lib/utils";

export const navIcons = {
  Activity,
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpFromLine,
  BarChart3,
  Bell,
  BellDot,
  BookOpen,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gauge,
  HeartPulse,
  Landmark,
  Layers,
  LayoutDashboard,
  Map,
  Network,
  Package,
  PackagePlus,
  Pencil,
  PlusCircle,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
  Upload,
  Users,
  Wrench
};

export type NavIconKey = keyof typeof navIcons;

type NavLinkProps = {
  href: string;
  label: string;
  iconKey: NavIconKey;
  // Data Entry Sidebar Reports/Notifications Disable Unit 10G.19: visible
  // but non-interactive — renders a <span>, never a <Link>, so there is no
  // href to navigate to and no click/keyboard-Enter activation at all.
  disabled?: boolean;
  disabledLabel?: string;
};

export function NavLink({ href, label, iconKey, disabled = false, disabledLabel }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const Icon = navIcons[iconKey] ?? navIcons.LayoutDashboard;

  if (disabled) {
    return (
      <span
        className="flex cursor-not-allowed items-center gap-3 rounded-lg border-l-[3px] border-transparent px-3 py-2.5 text-[15px] font-medium text-[#5B677E] opacity-55"
        aria-disabled="true"
        title={disabledLabel}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#5B677E]">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-lg border-l-[3px] px-3 py-2.5 text-[15px] font-medium transition-colors",
        isActive
          ? "border-[#ED1C24] bg-white text-[#0B1426] shadow-sm"
          : "border-transparent text-[#E8EDF5] hover:bg-white/[0.06] hover:text-white"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", isActive ? "bg-red-50 text-[#ED1C24]" : "text-[#93A0BD] group-hover:text-white")}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}
