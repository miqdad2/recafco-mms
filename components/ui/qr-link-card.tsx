import Link from "next/link";
import { QrCode } from "lucide-react";

import { createQrSvg, internalQrTarget } from "@/lib/qr/svg";

export async function QrLinkCard({ title, href }: { title: string; href: string }) {
  const target = internalQrTarget(href);
  const svg = await createQrSvg(target);

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#111827]">Scannable QR Code</h2>
          <p className="text-sm text-[#4B5563]">{title}</p>
        </div>
        <QrCode className="h-6 w-6 text-[#ED1C24]" aria-hidden="true" />
      </div>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div
          className="h-36 w-36 rounded-md border border-[#E5E7EB] bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
          aria-label={`QR code for ${href}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div>
          <p className="text-xs font-bold uppercase text-[#4B5563]">Internal route</p>
          <Link className="break-all text-sm font-bold text-[#ED1C24]" href={href}>
            {href}
          </Link>
          <p className="mt-2 break-all text-xs text-[#4B5563]">QR target: {target}</p>
        </div>
      </div>
    </section>
  );
}
