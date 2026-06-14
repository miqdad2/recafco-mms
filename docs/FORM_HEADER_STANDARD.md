# Form Document Header Standard

All RECAFCO internal forms share a single reusable header component that displays the company logo, department name, form title, and reference number. This ensures every document — whether displayed on screen or printed — carries a consistent official identity.

---

## Component

**Path:** `components/forms/form-document-header.tsx`

**Export:** `FormDocumentHeader`

---

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | — | Form or document title shown prominently (e.g. "Work Order") |
| `departmentName` | `string` | — | Department label shown in small caps above the title |
| `subtitle` | `string` | — | Secondary line below the title (e.g. generated timestamp) |
| `referenceNumber` | `string \| null` | — | Ref number or placeholder; omit entirely to hide the right side |
| `referenceLabel` | `string` | `"Ref."` | Label for the reference number |
| `status` | `string \| null` | — | Status shown below the reference number (`"print"` variant only) |
| `variant` | `"form" \| "print"` | `"form"` | Layout mode — see below |
| `logoSrc` | `string` | `"/recafco-logo.png"` | Logo asset path |

---

## Variants

### `variant="form"` — Digital data entry

Used inside paper-style data-entry forms. Features:

- Lighter gray background (`bg-[#F8FAFC]`) — the outer container styles are set by the calling form
- Smaller logo (`h-16 w-20`) with white background and subtle border
- Left: logo + department name (small caps) + form title (large bold)
- Right: read-only reference field with a placeholder (e.g. `REC/MD/JOB/Sr.No`)
- Responsive: stacks vertically on small screens, horizontal from `sm:` breakpoint

### `variant="print"` — Print / PDF

Used on all `*/print/page.tsx` pages. Features:

- White background — matched to the `<article>` print container
- Larger logo (`h-20 w-24`)
- Thick red bottom accent border (`border-b-4 border-[#ED1C24]`)
- Left: logo + department name + form title + generated timestamp subtitle
- Right: actual reference/document number in bold red, status below
- Logo uses `priority` prop so it loads before other images

---

## Logo Asset

**Path:** `/public/recafco-logo.png`

The logo is served as a static public asset and loaded through Next.js `<Image>` with `fill` layout and `object-contain` to avoid distortion. The container is `position: relative` (set inside the component).

For print, use `priority` on the Image to ensure the logo renders before the browser triggers print. This is already set in the component.

---

## Usage Examples

### Data-entry form header

```tsx
import { FormDocumentHeader } from "@/components/forms/form-document-header";

// Inside a paper-style form section:
<div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
  <FormDocumentHeader
    variant="form"
    title="Work Order"
    departmentName="Maintenance Department"
    referenceLabel="Ref:"
    referenceNumber="REC/MD/JOB/Sr.No"
  />
</div>
```

### Print page header

```tsx
import { FormDocumentHeader } from "@/components/forms/form-document-header";
import { formatDateTime } from "@/lib/utils";

// Inside a print <article>:
<FormDocumentHeader
  variant="print"
  title="Maintenance Work Order"
  departmentName="Maintenance Department"
  subtitle={`Generated: ${formatDateTime(new Date().toISOString())}`}
  referenceLabel="Work order number"
  referenceNumber={wo.work_order_number}
  status={wo.status}
/>
```

---

## Adding the Header to a New Form

1. Import the component:
   ```tsx
   import { FormDocumentHeader } from "@/components/forms/form-document-header";
   ```

2. Choose the correct variant:
   - `"form"` for digital paper-style data entry forms
   - `"print"` for print/PDF pages

3. Set the props appropriate for your form type.

4. For data-entry forms, wrap the component in the standard header container:
   ```tsx
   <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
     <FormDocumentHeader variant="form" title="..." ... />
   </div>
   ```

5. For print pages, place the component directly inside the `<article>` container (no wrapper needed — the component renders its own `border-b-4` divider).

---

## Print Behavior

- The logo renders via `next/image` with `priority`, ensuring it is available before the browser print dialog opens.
- `object-contain` keeps the logo proportional without cropping or distortion.
- The logo container has a fixed `h-20 w-24` size on print pages and `h-16 w-20` on form pages — avoiding large file rendering at print resolution.
- The component has no `display: none` at any print breakpoint — the logo always appears in printed output.
- Print pages already suppress the sidebar and header via `@media print` styles in the page's `<style>` tag; the form header is intentionally included.

---

## Forms Updated

| Form | Component / Page | Variant |
|------|-----------------|---------|
| Work Order create | `components/work-orders/work-order-form.tsx` (isNew branch) | `form` |
| Parts Request create | `components/store/parts-request-form.tsx` | `form` |
| Work Order print | `app/(dashboard)/maintenance/work-orders/[id]/print/page.tsx` | `print` |
| Parts Request print | `app/(dashboard)/store/parts-requests/[id]/print/page.tsx` | `print` |
| Purchase Request print | `app/(dashboard)/purchase/requests/[id]/print/page.tsx` | `print` |
| Asset Maintenance History print | `app/(dashboard)/assets/[id]/history/print/page.tsx` | `print` |
