import { BrandLogo } from "@/components/layout/brand-logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#F5F6F8]">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(460px,0.72fr)]">
        <section className="relative hidden overflow-hidden bg-[#111827] text-white lg:block">
          <div className="absolute inset-y-0 right-0 w-px bg-white/10" />
          <div className="absolute left-10 top-32 h-px w-40 bg-[#ED1C24]" />
          <div className="relative flex min-h-screen flex-col justify-between px-12 py-10">
            <BrandLogo variant="dark" size="lg" />

            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-wide text-red-200">Industrial maintenance control</p>
              <h1 className="mt-5 max-w-xl text-5xl font-black leading-tight">Maintenance work, approvals, and asset records in one secure system.</h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-gray-300">
                Built for RECAFCO teams handling work orders, assets, spare parts, purchase coordination, and management review.
              </p>

              <div className="mt-8 grid max-w-2xl grid-cols-3 gap-4">
                <div className="min-h-24 border-l-2 border-[#ED1C24] bg-white/[0.035] px-4 py-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Access</p>
                  <p className="mt-2 text-sm font-bold leading-5">Role based</p>
                </div>
                <div className="min-h-24 border-l-2 border-[#ED1C24] bg-white/[0.035] px-4 py-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Records</p>
                  <p className="mt-2 text-sm font-bold leading-5">Auditable</p>
                </div>
                <div className="min-h-24 border-l-2 border-[#ED1C24] bg-white/[0.035] px-4 py-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Mobile</p>
                  <p className="mt-2 text-sm font-bold leading-5">Technician ready</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <span>RECAFCO internal system</span>
              <span>Secure access only</span>
            </div>
          </div>
        </section>
        <section className="flex min-h-screen items-start justify-center bg-[#F5F6F8] px-4 pb-8 pt-12 sm:items-center sm:px-8 sm:py-8">{children}</section>
      </div>
    </main>
  );
}
