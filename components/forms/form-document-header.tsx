import Image from "next/image";

/**
 * Shared document header used on all RECAFCO internal forms — both the
 * paper-style digital data-entry forms and the PDF/print layouts.
 *
 * variant="form"  — lighter background, smaller logo, read-only ref field
 * variant="print" — white bg, thick red accent border, bold ref number
 */

interface FormDocumentHeaderProps {
  /** Primary form/document title (e.g. "Work Order", "Parts Request") */
  title: string;
  /** Department label shown above the title in small caps */
  departmentName?: string;
  /** Secondary line below the title (e.g. generated timestamp) */
  subtitle?: string;
  /**
   * Reference number or placeholder.
   * - "form" variant: pass a placeholder like "REC/MD/JOB/Sr.No"
   * - "print" variant: pass the actual document number (may be null)
   * - Omit entirely to hide the right-side section
   */
  referenceNumber?: string | null;
  /** Label above the reference number (default "Ref.") */
  referenceLabel?: string;
  /** Status shown below the reference number in the print variant */
  status?: string | null;
  /**
   * "form"  — paper-style digital form header used inside data-entry forms
   * "print" — document header used on print/PDF pages
   */
  variant?: "form" | "print";
  /** Logo asset path (default: /recafco-logo.png) */
  logoSrc?: string;
}

export function FormDocumentHeader({
  title,
  departmentName,
  subtitle,
  referenceNumber,
  referenceLabel = "Ref.",
  status,
  variant = "form",
  logoSrc = "/recafco-logo.png",
}: FormDocumentHeaderProps) {
  if (variant === "print") {
    return (
      <div className="flex items-start justify-between border-b-4 border-[#ED1C24] pb-5">
        {/* Left — logo + title */}
        <div className="flex items-center gap-4">
          <div className="relative h-20 w-24 flex-shrink-0 rounded-md border border-[#E5E7EB] bg-white">
            <Image
              src={logoSrc}
              alt="RECAFCO logo"
              fill
              className="object-contain p-1"
              priority
            />
          </div>
          <div>
            {departmentName && (
              <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">
                {departmentName}
              </p>
            )}
            <h1 className="text-2xl font-black">{title}</h1>
            {subtitle && (
              <p className="text-sm text-[#4B5563]">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Right — reference number + status */}
        {referenceNumber !== undefined && (
          <div className="text-right">
            <p className="text-sm text-[#4B5563]">{referenceLabel}</p>
            <p className="text-xl font-black text-[#ED1C24]">
              {referenceNumber ?? "Not assigned"}
            </p>
            {status && (
              <p className="mt-2 text-sm font-bold">{status}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // "form" variant — paper-style digital form header
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      {/* Left — logo + department + title */}
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-20 flex-shrink-0 rounded border border-[#DDE2EA] bg-white">
          <Image
            src={logoSrc}
            alt="RECAFCO logo"
            fill
            className="object-contain p-1"
            priority
          />
        </div>
        <div>
          {departmentName && (
            <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">
              {departmentName}
            </p>
          )}
          <h2 className="text-2xl font-black text-[#2B2B2B]">{title}</h2>
          {subtitle && (
            <p className="text-xs text-[#4B5563]">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Right — read-only reference placeholder */}
      {referenceNumber !== undefined && (
        <p className="flex-shrink-0 text-sm font-semibold text-[#111827]">
          {referenceLabel}
          <input
            className="ml-2 w-52 border-b border-[#2B2B2B] bg-transparent px-2 py-1 text-sm outline-none"
            value={referenceNumber ?? ""}
            readOnly
            aria-label={referenceLabel}
          />
        </p>
      )}
    </div>
  );
}
