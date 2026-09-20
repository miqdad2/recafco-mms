import { FormDocumentHeader } from "@/components/forms/form-document-header";
import { formatDateTime } from "@/lib/utils";

// Printable Division-Based Reports Foundation Unit 10G.69, Task 1.
//
// Reusable Header/Body/Footer shell for every printable, division-filterable
// report this unit adds (Job Card Summary, Asset Repair History, Materials
// Usage) and for whichever reports reuse it later (Technician Workload,
// Inventory Control — Task 12's own "make the reusable layout ready for
// other reports later"). The print CSS block below is the same, already
// twice-refined-in-production set of rules the single Job Card print page
// uses (app/(dashboard)/maintenance/work-orders/[id]/print/page.tsx, Unit
// 10G.57/57A/57B/57C) — A4 portrait, repeating table header, per-row
// avoid-break, hidden dashboard chrome — reused verbatim rather than
// reinvented, since it was already hardened against real Chrome print
// preview issues (page-2 orphaning, split rows).
//
// Body content (summary section + detailed table + optional notes) is left
// to each report page as `children`, since a generic component can't know
// each report's own table columns — this shell only owns the parts every
// printable report shares: header, summary card grid, signatures, footer.

export type PrintSummaryItem = { label: string; value: string | number; tone?: "red" | "amber" | "green" | "blue" | "gray" };
export type PrintFilterItem = { label: string; value: string };

const TONE_TEXT: Record<NonNullable<PrintSummaryItem["tone"]>, string> = {
  red: "text-[#DC2626]",
  amber: "text-amber-700",
  green: "text-green-700",
  blue: "text-[#2563EB]",
  gray: "text-[#111827]",
};

export function ReportPrintShell({
  reportTitle,
  generatedBy,
  generatedAtIso,
  filters,
  summary,
  notes,
  children,
}: {
  reportTitle: string;
  generatedBy: string;
  generatedAtIso: string;
  /** Division / Date Range / Status / etc. — whatever this report's own filter bar resolved to. */
  filters: PrintFilterItem[];
  summary: PrintSummaryItem[];
  notes?: string;
  children: React.ReactNode;
}) {
  const reportReference = `RPT-${generatedAtIso.slice(0, 10).replace(/-/g, "")}-${generatedAtIso.slice(11, 16).replace(":", "")}`;

  return (
    <div className="min-h-screen bg-[#F3F5F8] px-4 py-6 text-[#111827] print:min-h-0 print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .screen-only, .no-print { display: none !important; }
          aside, header, nav { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; }
          .print-sheet {
            box-sizing: border-box !important;
            border: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
          .print-signatures { break-inside: avoid; page-break-inside: avoid; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
          .print-table-heading { break-after: avoid; page-break-after: avoid; }
          .print-table thead { display: table-header-group; }
          .print-table tr { page-break-inside: avoid; break-inside: avoid; }
          .signature-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
      `}</style>

      <article className="print-sheet mx-auto w-full max-w-[210mm] border border-[#E5E7EB] bg-white p-6 text-[10.5px] leading-snug shadow-sm">
        <div className="avoid-break">
          <FormDocumentHeader
            variant="print"
            compact
            title={reportTitle}
            departmentName="Maintenance Department"
            subtitle={`Generated: ${formatDateTime(generatedAtIso)} · By: ${generatedBy}`}
            referenceLabel="Report Reference"
            referenceNumber={reportReference}
          />

          {/* Task 1/11 — Division and Date Range (plus whatever else this
              report's own filter bar resolved to) always visible right
              under the header, both on screen and on the printed page. */}
          {filters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-b border-[#E5E7EB] pb-2 text-[9.5px]">
              {filters.map((f) => (
                <span key={f.label}>
                  <span className="font-bold uppercase text-[#6B7280]">{f.label}:</span>{" "}
                  <span className="font-semibold text-[#111827]">{f.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Summary section (Task 1's "Body: Summary section"). */}
        {summary.length > 0 && (
          <section className="avoid-break mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {summary.map((s) => (
              <div key={s.label} className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-2 text-center">
                <p className={`text-base font-black ${s.tone ? TONE_TEXT[s.tone] : "text-[#111827]"}`}>{s.value}</p>
                <p className="mt-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#6B7280]">{s.label}</p>
              </div>
            ))}
          </section>
        )}

        {/* Body: detailed table section (Task 1) — supplied by the caller,
            allowed to flow naturally across multiple printed pages (Task
            1/11's "allow multi-page reports naturally" / "continue on page
            2 cleanly"); the .print-table CSS above repeats its <thead> and
            protects each <tr> from being split mid-row. */}
        {children}

        {notes && (
          <section className="avoid-break mt-3">
            <h3 className="border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">Notes</h3>
            <p className="mt-1.5 text-[10px] leading-relaxed">{notes}</p>
          </section>
        )}

        {/* Footer (Task 1/11): Prepared by / Checked by / Maintenance
            Manager signature boxes, plus the exact required footer note. */}
        <section className="print-signatures mt-6 avoid-break">
          <h3 className="border-b border-[#E5E7EB] pb-1 text-[10px] font-black uppercase tracking-wide">Signatures</h3>
          <div className="signature-grid mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SignatureBox label="Prepared By" />
            <SignatureBox label="Checked By" />
            <SignatureBox label="Maintenance Manager" />
          </div>
        </section>

        <p className="mt-4 border-t border-[#E5E7EB] pt-2 text-center text-[8.5px] text-[#9CA3AF]">
          Generated from RECAFCO Maintenance Management System
        </p>
      </article>
    </div>
  );
}

function SignatureBox({ label }: { label: string }) {
  return (
    <div className="rounded-sm border border-[#E5E7EB] p-2">
      <p className="text-[8.5px] font-bold uppercase text-[#6B7280]">{label}</p>
      <p className="mt-4 min-h-10 border-t border-dashed border-[#E5E7EB] pt-1 text-[10px]">&nbsp;</p>
    </div>
  );
}
