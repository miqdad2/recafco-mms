import { architectureEnvVars, deploymentOptions } from "@/lib/architecture/config";
import { ChipList, SectionShell, toneClasses } from "@/components/architecture/shared";

export function DeploymentArchitecture() {
  return (
    <SectionShell eyebrow="Deployment" title="Deployment Architecture">
      <div className="grid gap-4 lg:grid-cols-3">
        {deploymentOptions.map((option) => {
          const tone = toneClasses[option.tone];
          return (
            <article key={option.area} className={`rounded-md border-t-4 ${tone.border} border-x border-b bg-white p-5 shadow-sm`}>
              <h3 className="text-lg font-black text-[#111827]">{option.area}</h3>
              <ul className="mt-4 space-y-2">
                {option.items.map((item) => (
                  <li key={item} className="text-sm font-semibold text-[#4B5563]">{item}</li>
                ))}
              </ul>
            </article>
          );
        })}
        <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm lg:col-span-3">
          <h3 className="mb-3 text-base font-black text-[#111827]">Environment variables</h3>
          <ChipList items={architectureEnvVars} />
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm font-semibold text-[#7F1D1D]">
            `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to browser code. Production variables, backups, and monitoring must be controlled by IT.
          </p>
        </div>
      </div>
    </SectionShell>
  );
}
