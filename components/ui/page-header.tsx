import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="border-b border-[#DDE2EA] bg-white px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 border-l-4 border-[#ED1C24] pl-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">RECAFCO MMS</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[#111827]">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-[#4B5563]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
