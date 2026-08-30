import { BrandLogo } from "@/components/layout/brand-logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#F5F6F8]">
      {/* Right Panel Width Polish Unit 10G.47, Task 1: Unit 10G.45 had
          pushed this ratio to ~71%/29% (1.25fr:0.52fr) chasing "less empty
          margin around the card" — that overcorrected and left the login
          side feeling squeezed. Rebalanced to ~59%/41% (1.45fr:1fr), within
          the requested 58-60%/40-42% split — coincidentally close to where
          Unit 10G.43 originally had it (1fr:0.72fr ~= 58%/42%) before the
          intervening units drifted it leftward. Right column's floor
          bumped 480px -> 500px so the card (max-w-480, Task 2) never gets
          squeezed by its own section padding even at exactly the lg
          breakpoint. */}
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.45fr)_minmax(500px,1fr)]">
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
          {/* Visual Balance Improvement Unit 10G.44, Task 2: overlay opacity
              trimmed down at every stop (90/82/72 -> 78/66/54) so the
              factory photo actually reads through instead of going nearly
              solid navy — text keeps its own drop-shadow below for
              readability instead of leaning on a near-opaque overlay. */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B1220]/78 via-[#111827]/66 to-[#111827]/54" aria-hidden="true" />
          <div className="absolute inset-y-0 right-0 w-px bg-white/10" />
          {/* Left Header Logo Polish Unit 10G.46, Task 1: RECAFCO logo
              restored here as the page's official brand mark — logo only,
              no "RECAFCO" / "Maintenance & Asset Management" text beside
              it (Unit 10G.43 removed exactly that pairing as repetitive
              with the login card; re-adding the logo alone doesn't undo
              that). It's a normal-flow flex item above the text block, not
              absolutely positioned, so it can never overlap the title —
              the text block's own flex-1 wrapper just centers within
              whatever vertical space remains below it. Visual Balance
              Improvement Unit 10G.44, Task 1: that text block still needs
              its own flex-1 wrapper (not a plain `justify-center` on the
              outer column) to actually center in the space above the
              footer — see that unit's note for why. */}
          <div className="relative flex min-h-screen flex-col px-12 py-12">
            <BrandLogo variant="dark" size="xl" showText={false} />
            {/* Final Polish Unit 10G.45, Task 4: a bit of bottom padding on
                this centering wrapper biases the text block slightly above
                dead-center (a touch closer to the classic hero-text
                position) rather than sitting exactly in the vertical
                middle of the photo. */}
            <div className="flex flex-1 flex-col justify-center pb-16">
              <div className="max-w-[600px]">
                <p className="text-sm font-bold uppercase tracking-wide text-red-200">RECAFCO internal system</p>
                <h1
                  className="mt-5 text-4xl font-black leading-[1.15]"
                  style={{ textShadow: "0 2px 16px rgba(0,0,0,0.5)" }}
                >
                  Maintenance Management System
                </h1>
                <p
                  className="mt-6 max-w-[520px] text-base leading-7 text-gray-200"
                  style={{ textShadow: "0 1px 8px rgba(0,0,0,0.45)" }}
                >
                  Secure access for RECAFCO maintenance operations.
                </p>
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
