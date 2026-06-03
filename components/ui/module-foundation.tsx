import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type ModuleFoundationProps = {
  title: string;
  description: string;
  phase: string;
  items: string[];
};

export function ModuleFoundation({ title, description, phase, items }: ModuleFoundationProps) {
  return (
    <>
      <PageHeader title={title} description={description} actions={<StatusBadge label={phase} tone="amber" />} />
      <div className="p-4 lg:p-6">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#111827]">Foundation ready</h2>
          <p className="mt-1 text-sm text-[#4B5563]">This route is protected and ready for the next implementation phase.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {items.map((item) => (
              <div key={item} className="rounded-md border border-[#E5E7EB] p-3 text-sm font-semibold text-[#111827]">
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
