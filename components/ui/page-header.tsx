import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="border-b border-[#DDE2EA] bg-white px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex min-w-0 flex-col gap-4 border-l-4 border-[#ED1C24] pl-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">RECAFCO MMS</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-[#111827] sm:text-3xl">{title}</h1>
          {description ? <p className="mt-2 hidden max-w-3xl text-sm leading-6 text-[#4B5563] sm:block">{description}</p> : null}
        </div>
        {actions ? <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">{actions}</div> : null}
      </div>
    </div>
  );
}
