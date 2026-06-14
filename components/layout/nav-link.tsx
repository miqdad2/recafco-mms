"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
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
  LayoutDashboard,
  Map,
  Network,
  Package,
  Pencil,
  PlusCircle,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
  Users,
  Wrench
} from "lucide-react";

import { cn } from "@/lib/utils";

export const navIcons = {
  Activity,
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
  LayoutDashboard,
  Map,
  Network,
  Package,
  Pencil,
  PlusCircle,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
  Users,
  Wrench
};

export type NavIconKey = keyof typeof navIcons;

type NavLinkProps = {
  href: string;
  label: string;
  iconKey: NavIconKey;
};

export function NavLink({ href, label, iconKey }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const Icon = navIcons[iconKey] ?? navIcons.LayoutDashboard;

  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition",
        isActive ? "bg-white text-[#111827] shadow-sm" : "text-gray-300 hover:bg-white/10 hover:text-white"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", isActive ? "bg-red-50 text-[#ED1C24]" : "text-gray-400 group-hover:text-white")}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className={cn("truncate", isActive ? "text-[#111827]" : "text-gray-200 group-hover:text-white")}>{label}</span>
    </Link>
  );
}
