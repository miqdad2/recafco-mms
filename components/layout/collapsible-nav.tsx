"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { NavLink, type NavIconKey } from "@/components/layout/nav-link";
import { cn } from "@/lib/utils";

export type CollapsibleNavItem = {
  href: string;
  label: string;
  iconKey: NavIconKey;
};

export type CollapsibleNavGroup = {
  label: string | null;
  items: CollapsibleNavItem[];
};

function groupIsActive(group: CollapsibleNavGroup, pathname: string): boolean {
  return group.items.some(
    (item) =>
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
  );
}

export function CollapsibleNav({ groups }: { groups: CollapsibleNavGroup[] }) {
  const pathname = usePathname();

  // Labeled groups start collapsed unless they contain the active page
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const state: Record<string, boolean> = {};
    groups.forEach((g) => {
      if (g.label) {
        state[g.label] = !groupIsActive(g, pathname);
      }
    });
    return state;
  });

  // Re-expand the active group whenever the route changes
  useEffect(() => {
    groups.forEach((g) => {
      if (g.label && groupIsActive(g, pathname)) {
        setCollapsed((prev) => ({ ...prev, [g.label!]: false }));
      }
    });
  }, [pathname, groups]);

  function toggle(label: string) {
    // Don't collapse if this group contains the current page
    const group = groups.find((g) => g.label === label);
    if (group && groupIsActive(group, pathname)) return;
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  return (
    <>
      {groups.map((group, idx) => {
        if (!group.label) {
          // Direct items — no header, no toggle
          return (
            <div key={`__direct__${idx}`} className={idx > 0 ? "mt-2" : ""}>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} iconKey={item.iconKey} />
                ))}
              </div>
            </div>
          );
        }

        const isCollapsed = collapsed[group.label] === true;
        const isActive = groupIsActive(group, pathname);

        return (
          <div key={group.label} className="mt-3">
            <button
              type="button"
              onClick={() => toggle(group.label!)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold transition select-none",
                isActive
                  ? "bg-white/10 text-white"
                  : "text-gray-400 hover:bg-white/10 hover:text-white"
              )}
              aria-expanded={!isCollapsed}
            >
              <span>{group.label}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform duration-150",
                  isCollapsed ? "-rotate-90" : "rotate-0"
                )}
                aria-hidden="true"
              />
            </button>
            {!isCollapsed && (
              <div className="mt-0.5 space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} iconKey={item.iconKey} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
