import { NavLink, type NavIconKey } from "@/components/layout/nav-link";

export type CollapsibleNavItem = {
  href: string;
  label: string;
  iconKey: NavIconKey;
};

export type CollapsibleNavGroup = {
  label: string | null;
  items: CollapsibleNavItem[];
};

export function CollapsibleNav({ groups }: { groups: CollapsibleNavGroup[] }) {
  return (
    <>
      {groups.map((group, idx) => (
        <div key={group.label ?? `__direct__${idx}`} className={idx > 0 ? "mt-6" : ""}>
          {group.label && (
            <p className="select-none px-3 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-[#7F8BA3]">
              {group.label}
            </p>
          )}
          <div className="space-y-1">
            {group.items.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} iconKey={item.iconKey} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
