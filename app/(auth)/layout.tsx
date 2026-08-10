import { BrandLogo } from "@/components/layout/brand-logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#F5F6F8]">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(460px,0.72fr)]">
        <section className="relative hidden overflow-hidden bg-[#111827] text-white lg:block">
          {/* Hero background photo — cover/center/no-repeat so it fills the
              panel at any height without stretching or distorting. Sits
              behind the navy gradient overlay below, which does the actual
              work of keeping the white text readable over any part of the
              image. */}
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: "url('/bg_img.jpg')" }}
            aria-hidden="true"
          />
          {/* Dark navy overlay, darker top-left fading slightly lighter
              bottom-right — keeps this a "readable text panel with a photo
              behind it," not a busy photo with text stamped on top. */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B1220]/90 via-[#111827]/82 to-[#111827]/72" aria-hidden="true" />
          <div className="absolute inset-y-0 right-0 w-px bg-white/10" />
          <div className="relative flex min-h-screen flex-col px-12 py-12">
            <BrandLogo variant="dark" size="lg" />

            <div className="mt-24 max-w-[620px]">
              <p className="text-sm font-bold uppercase tracking-wide text-red-200">Maintenance Department System</p>
              <h1
                className="mt-4 text-5xl font-black leading-[1.1]"
                style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}
              >
                Maintenance operations in one secure system.
              </h1>
              <p
                className="mt-5 max-w-[560px] text-base leading-7 text-gray-200"
                style={{ textShadow: "0 1px 8px rgba(0,0,0,0.4)" }}
              >
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
