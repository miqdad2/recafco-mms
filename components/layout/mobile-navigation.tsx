"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { navIcons, type NavIconKey } from "@/components/layout/nav-link";
import { cn } from "@/lib/utils";

export type MobileNavigationItem = {
  href: string;
  label: string;
  iconKey: NavIconKey;
};

type MobileNavigationProps = {
  items: MobileNavigationItem[];
};

export function MobileNavigation({ items }: MobileNavigationProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const quickItemHrefs = ["/dashboard", "/maintenance/work-orders", "/maintenance/approvals"];
  const prioritizedItems = quickItemHrefs
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is MobileNavigationItem => Boolean(item));
  const fallbackItems = items.filter((item) => !prioritizedItems.some((quickItem) => quickItem.href === item.href));
  const quickItems = [...prioritizedItems, ...fallbackItems].slice(0, 3);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[#E5E7EB] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_24px_rgba(15,23,42,0.08)] lg:hidden">
        {quickItems.map((item) => {
          const Icon = navIcons[item.iconKey];
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-t-2 px-1 text-[11px] font-bold transition",
                isActive ? "border-[#ED1C24] text-[#ED1C24]" : "border-transparent text-[#4B5563]"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className="focus-ring flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] font-bold text-[#111827]"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="mobile-navigation-drawer"
        >
          <Menu className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>Menu</span>
        </button>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-40 bg-[#111827]/55 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />
      ) : null}

      <aside
        id="mobile-navigation-drawer"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(92vw,24rem)] flex-col border-l border-[#DDE2EA] bg-white shadow-2xl transition-transform duration-200 lg:hidden",
          open ? "translate-x-0" : "translate-x-full"
        )}
        aria-hidden={!open}
      >
        <div className="flex min-h-20 items-center justify-between gap-3 border-b border-[#E5E7EB] px-4">
          <BrandLogo variant="light" size="sm" showText={false} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-[#111827]">RECAFCO MMS</p>
            <p className="truncate text-xs font-semibold text-[#4B5563]">Role-based navigation</p>
          </div>
          <button type="button" className="focus-ring rounded-md border border-[#E5E7EB] p-2 text-[#111827]" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => {
            const Icon = navIcons[item.iconKey];
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.href}
                href={item.href}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-bold transition",
                isActive ? "bg-red-50 text-[#ED1C24]" : "text-[#111827] hover:bg-[#F3F5F8]"
              )}
              onClick={() => setOpen(false)}
              aria-current={isActive ? "page" : undefined}
            >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", isActive ? "bg-white text-[#ED1C24]" : "bg-[#F3F5F8] text-[#4B5563]")}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
