import { BrandLogo } from "@/components/layout/brand-logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#F5F6F8]">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(460px,0.72fr)]">
        <section className="relative hidden overflow-hidden bg-[#111827] text-white lg:block">
          <div className="absolute inset-y-0 right-0 w-px bg-white/10" />
          <div className="relative flex min-h-screen flex-col px-12 py-12">
            <BrandLogo variant="dark" size="lg" />

            <div className="mt-24 max-w-[620px]">
              <p className="text-sm font-bold uppercase tracking-wide text-red-200">Maintenance Department System</p>
              <h1 className="mt-4 text-5xl font-black leading-[1.1]">Maintenance operations in one secure system.</h1>
              <p className="mt-5 max-w-[560px] text-base leading-7 text-gray-300">
                Built for RECAFCO Maintenance Department to manage job cards, materials requests, assets, service contracts, and offline inventory records.
              </p>
            </div>

            <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
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
