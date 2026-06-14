import { databaseGroups, databaseRelationships } from "@/lib/architecture/config";
import { FlowRail, SectionShell, toneClasses } from "@/components/architecture/shared";

export function DatabaseModel() {
  return (
    <SectionShell eyebrow="Data model" title="Database and RLS Model">
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
          {databaseGroups.map((group) => {
            const tone = toneClasses[group.tone];
            return (
              <div key={group.name} className={`rounded-md border-t-4 ${tone.border} border-x border-b bg-white p-4 shadow-sm`}>
                <h3 className="text-base font-black text-[#111827]">{group.name}</h3>
                <div className="mt-3 space-y-2">
                  {group.tables.map((table) => (
                    <div key={table} className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 font-mono text-xs font-bold text-[#111827]">
                      {table}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-lg font-black text-[#111827]">Simplified relationship flow</h3>
          <FlowRail steps={databaseRelationships} compact />
        </div>
      </div>
    </SectionShell>
  );
}
