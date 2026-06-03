"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  ClipboardList,
  Gauge,
  Landmark,
  LayoutDashboard,
  Map,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wrench
} from "lucide-react";

import { cn } from "@/lib/utils";

export const navIcons = {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  ClipboardList,
  Gauge,
  Landmark,
  LayoutDashboard,
  Map,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wrench
};

export type NavIconKey = keyof typeof navIcons;

type NavLinkProps = {
  href: string;
  label: string;
  icon: NavIconKey;
};

export function NavLink({ href, label, icon }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const Icon = navIcons[icon];

  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition",
        isActive ? "bg-white text-[#111827] shadow-sm" : "text-gray-300 hover:bg-white/10 hover:text-white"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", isActive ? "bg-red-50 text-[#ED1C24]" : "text-gray-300 group-hover:text-white")}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className={cn("truncate", isActive ? "text-[#111827]" : "text-gray-100 group-hover:text-white")}>{label}</span>
    </Link>
  );
}
