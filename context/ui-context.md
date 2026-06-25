# UI Context

## Theme

A professional light enterprise interface with strong RECAFCO branding. The design prioritizes speed, clarity, status visibility, and low training effort for factory, maintenance, store, office, and executive users.

## Colors

| Role | Variable | Value |
|---|---|---|
| Background | `--background` | `#f5f6f8` |
| Foreground | `--foreground` | `#111827` |
| Primary | `--primary` | `#ed1c24` |
| Charcoal | `--charcoal` | `#2b2b2b` |
| Border | `--border` | `#e5e7eb` |

Use verified tokens or established Tailwind utilities. Do not add unrelated color systems without updating this file.

## Typography

Current stack:

```css
Arial, Helvetica, sans-serif
```

No external web font is active.

## Styling

- Tailwind CSS v4
- `@import "tailwindcss"`
- No `tailwind.config.ts`
- No shadcn/ui
- No Radix UI
- Custom shared components

## Border Radius

No global radius token. Current forms use restrained enterprise styling such as `rounded-md` and `0.375rem` inputs.

## Focus and Accessibility

Focus ring uses 2px RECAFCO red with 2px offset.

Requirements:

- Visible keyboard focus
- Semantic labels
- Connected validation errors
- Clear loading and disabled states
- Explicit permission-denied states
- Helpful empty states

## Mobile

Breakpoint: 640px.

At mobile sizes:

- Form text is at least 16px.
- Interactive controls are at least 44px high.
- Navigation switches to mobile mode.
- Forms become primarily single-column.
- Tables scroll or use responsive alternatives.
- Primary actions remain reachable.

## Reduced Motion

Respect `prefers-reduced-motion`. New animations must include a reduced-motion alternative.

Current animations:

- recafco-brand-enter
- recafco-scan
- system-map-fade-up
- system-map-line
- system-map-connector-pulse
- page-loading-spin
- page-loading-bar

## Component Library

Shared custom components include:

- ActionToast
- Button
- CostVisibilityGuard
- EmptyState
- ErrorState
- Field
- FormSection
- LoadingState
- ModuleFoundation
- PageHeader
- PageLoading
- PermissionDenied
- QrLinkCard
- RetryPanel
- StatusBadge
- SubmitButton
- SystemErrorCard

Prefer extension of shared components over page-specific duplicates.

## Layout Patterns

### App Layout

Desktop uses persistent navigation and a main content area. Mobile uses a dedicated mobile navigation pattern.

### Page Order

1. Page header
2. Summary/status strip
3. Primary actions
4. Filters/search
5. Main table/form/content
6. Supporting history/audit

### Forms

Use `FormSection`, `Field`, clear required indicators, inline validation, strong submit states, and consistent action placement.

### Tables

Use clear labels, shared status presentation, explicit empty states, responsive overflow, permission-aware cost columns, and accessible row actions.

## Authentication Layout

Desktop uses a dark branded left panel and a form panel on the right. Mobile uses a single-column layout.

## CEO UI

CEO pages must be executive-only.

Do not expose create/edit controls, technician operations, store operations, or dense operational tabs.

Use early role return:

```tsx
if (context.role?.slug === "ceo_management") {
  return <CeoView />;
}
```

## Cost Visibility

Cost values are server-gated with `canViewCosts(context)`. Do not rely on CSS or client-only hiding.

## States

Use shared loading, error, retry, empty, and permission-denied components. Never expose stack traces.

## Icons

Use `lucide-react` consistently.

## Print Views

Printed work orders and reports must show RECAFCO identity, document number, dates, approvals, readable tables, and no screen-only controls.

## Rules

1. Prefer shared components.
2. Preserve RECAFCO red as primary accent.
3. Avoid random hardcoded colors.
4. Preserve 44px mobile targets.
5. Use shared status badges.
6. Keep CEO views non-operational.
7. Gate cost values on the server.
8. Respect reduced motion.
9. Prioritize operational clarity.
10. Update this file when tokens or component conventions change.
