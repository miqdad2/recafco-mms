import { Boxes, HardHat, ShieldCheck, Wrench } from "lucide-react";

import { AuthLogo } from "@/components/auth/auth-logo";

// Informational only — these are not links on a pre-login screen.
const highlights = [
  { icon: Wrench, title: "Job Cards", subtitle: "& Work Orders" },
  { icon: Boxes, title: "Materials", subtitle: "& Inventory" },
  { icon: HardHat, title: "Workers", subtitle: "& Maintenance" }
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#F4F7FB]">
      {/* Login Redesign: ~60/40 split on desktop. The right column keeps a
          500px floor so the 480px card never gets squeezed at exactly the
          lg breakpoint; above ~1250px the 3:2 ratio takes over. */}
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.5fr)_minmax(500px,1fr)]">
        <section className="relative hidden overflow-hidden bg-[#0B1424] text-white lg:block">
          {/* The real RECAFCO factory photo. Positioned well right of centre so
              the lit hall and the RECAFCO sign stay in frame when the
              4:3 photo is cropped to a taller panel. */}
          <div
            className="absolute inset-0 bg-cover bg-no-repeat bg-[position:82%_center]"
            style={{ backgroundImage: "url('/bg_img.jpg')" }}
            aria-hidden="true"
          />
          {/* Navy overlay: heavy on the left where the text sits, light on
              the right so the lit building reads through, plus a bottom
              fade that keeps the footer legible over the wet floor. */}
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#081226]/85 via-[#0B1730]/40 to-transparent"
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#060D1C]/80 via-transparent to-[#060D1C]/25" aria-hidden="true" />

          <div className="relative flex min-h-screen flex-col px-12 pb-8 pt-12 xl:px-16 2xl:px-20 2xl:pt-16">
            <div className="w-fit rounded-2xl bg-white px-3 py-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]">
              <AuthLogo className="w-[124px] 2xl:w-[148px]" priority />
            </div>

            <div className="flex flex-1 flex-col justify-center py-10">
              <div className="max-w-[560px]">
                <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.14em] text-white/90">
                  <span className="h-6 w-1 rounded-full bg-[#ED1C24]" aria-hidden="true" />
                  RECAFCO internal system
                </p>
                <p
                  className="mt-5 text-[44px] font-black leading-[1.04] tracking-[-0.02em] xl:text-5xl 2xl:text-[56px]"
                  style={{ textShadow: "0 2px 18px rgba(0,0,0,0.45)" }}
                >
                  Maintenance
                  <br />
                  Management
                  <br />
                  <span className="text-[#ED1C24]">System</span>
                </p>
                <p
                  className="mt-6 max-w-[440px] text-[17px] leading-7 text-[#D7DEEA]"
                  style={{ textShadow: "0 1px 8px rgba(0,0,0,0.45)" }}
                >
                  Secure access for RECAFCO maintenance operations, job cards, materials, and work management.
                </p>
              </div>

              <ul className="mt-10 grid w-full max-w-[480px] grid-cols-3 gap-4" aria-label="System areas">
                {highlights.map(({ icon: Icon, title, subtitle }) => (
                  <li
                    key={title}
                    className="flex flex-col items-center rounded-[14px] border border-white/15 bg-[#0B1630]/70 px-3 py-5 text-center backdrop-blur-[2px]"
                  >
                    <Icon className="h-8 w-8 text-[#ED1C24]" strokeWidth={1.75} aria-hidden="true" />
                    <span className="mt-3 text-sm font-semibold leading-5 text-white">{title}</span>
                    <span className="text-sm leading-5 text-white/85">{subtitle}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-6 text-xs font-semibold uppercase tracking-[0.16em] text-[#C3CBD8]">
              <span className="shrink-0">RECAFCO internal system</span>
              <span className="h-px flex-1 bg-white/20" aria-hidden="true" />
              <span className="flex shrink-0 items-center gap-2">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Secure access only
              </span>
            </div>
          </div>
        </section>

        <section className="flex min-h-screen flex-col bg-[linear-gradient(160deg,#F7F9FC_0%,#EEF2F7_100%)]">
          {/* Below lg the photo panel is hidden; tablets get a slim
              branded photo strip so the page still reads as RECAFCO, while
              phones go straight to the form (the card carries the logo). */}
          <div className="relative hidden h-36 overflow-hidden bg-[#0B1424] md:block lg:hidden">
            <div
              className="absolute inset-0 bg-cover bg-no-repeat bg-[position:60%_62%]"
              style={{ backgroundImage: "url('/bg_img.jpg')" }}
              aria-hidden="true"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#081226]/90 via-[#0B1730]/60 to-[#0B1730]/20" aria-hidden="true" />
            <div className="relative flex h-full items-center px-10">
              <p className="text-2xl font-black leading-tight text-white">
                Maintenance Management <span className="text-[#ED1C24]">System</span>
              </p>
            </div>
          </div>
          <div className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center sm:px-8 sm:py-10 lg:[@media(max-height:820px)]:py-5">{children}</div>
        </section>
      </div>
    </main>
  );
}
