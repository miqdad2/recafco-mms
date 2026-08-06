# RECAFCO MMS — Feedback & Popup Design Standard

Established by Popup and Feedback Design Standardization Unit 8D. Read this
before adding any new success/error/confirmation UI — reuse one of the
patterns below instead of hand-rolling a new popup/banner style.

## The two feedback formats

### 1. Workflow Success Modal — `components/ui/workflow-success-modal.tsx`

Centered, backdrop-blocking, requires an explicit dismiss. Use for major
workflow actions where the user needs "what happened, what's next":

- Job Card Started / Job Card Draft Saved / Job Card Created
- Job Card Closed
- Closure Requested / Closure Approved
- Materials Request Created / Materials Received
- Correction Requested sent
- Any action that changes the Job Card's workflow status/meaning

Do **not** use it for a save that doesn't change what stage a record is at —
that's what the toast is for. A full modal on every quick save trains users
to blindly click through it, which defeats the point of using one at all for
the actions that actually need attention.

**Usage:** render conditionally (`{show && <WorkflowSuccessModal .../>}`),
same as every other modal in this codebase — no portal, no `open` prop.
Pass `title`, `description`, `primaryAction`/`secondaryActions`
(`{kind:"link"|"button"|"form", ...}`), optionally `summaryItems`
(label/value pairs — value can be any ReactNode, e.g. a `<StatusBadge/>` or a
`<ul>` of requested items), `statusLabel`, `nextStepTitle`/
`nextStepDescription`, `progressSteps` (stage pill row), and `warnings`
(amber inline notices, e.g. "some attachments failed to upload").

**Wording pattern (Task 4):**
- Title: short, past-tense-ish state — "Job Card Started", "Closure
  Requested", "Materials Request Created".
- Description: `<record> <id> is now <state>.` — concrete, names the record.
- Next step: a specific instruction — "Continue this Job Card to assign
  workers, issue materials, or track work time." Never the old vague
  "Assign work, update details, or request closure once work is done."
  (retired by this unit — every modal now uses case-specific next-step text).
- Buttons: primary is the one useful next click ("Continue This Job Card",
  "View Job Card", "Go to Materials Request"); secondary are "Create
  Another"/"Go to List"; the de-emphasized text-only "Close" always exists
  and always calls the same `closeAction`.

### 2. Quick Feedback Toast — `components/ui/action-toast.tsx`

Compact, corner-anchored (bottom-right on desktop, above the mobile bottom
nav on small screens), non-blocking, auto-dismisses after 6s, manual close
always available. Use for minor/quick confirmations:

- Material Issued / Material Received
- Work Session Started / Paused / Stopped
- Manual Time Entry Saved / Session Updated / Session Cancelled
- Worker Profile Saved
- Assignment Updated (a quick edit — reassigning who's on a Job Card doesn't
  change the Job Card's workflow status, unlike e.g. closing it)
- File Uploaded
- Small edit/update confirmations generally

**Two ways to trigger it** (same rendered UI either way — `<ActionToast />`
is mounted once, globally, in `components/layout/app-layout.tsx`):

1. **Redirect-based** (most server actions): redirect to
   `...?success=<code>` (or `?error=<code>`). `<ActionToast/>` reads the
   code via `resolveToastMessage()` in `lib/action-messages.ts`, shows the
   matching toast, then strips the param from the URL without a navigation.
   Add new codes to `SUCCESS_MAP`/`ERROR_MAP` there — don't invent a
   page-local mapping (see "Found and fixed" below for why).
2. **Imperative** (client components whose save action doesn't
   redirect/navigate — `useActionState` forms like work sessions, manual
   time entry, worker profile): call `dispatchActionToast({tone, title,
   description?})` from `lib/action-messages.ts` in a `useEffect` once the
   action state comes back `ok: true`.

If a success code already has its own Workflow Success Modal, add it to
`SUPPRESSED_SUCCESS_CODES` in `lib/action-messages.ts` so the toast doesn't
fire alongside it.

### 3. Inline field/form error (not a new pattern — already consistent)

Every `useActionState` form in this app (work sessions, manual time entry,
worker profile, offline inventory issue/receive, etc.) already shows a
validation/save error as a small red box directly inside the form
(`state?.ok === false && <div className="border-red-200 bg-red-50 ...">`).
This is correct as-is for **field-scoped** errors — the error is right next
to what needs fixing. Don't convert these to toasts; a toast for "quantity
required" would separate the message from the field the user needs to
correct.

## Error and warning rules (Task 7)

- **Confirmation modal** — dangerous/destructive, hard-to-undo actions:
  Delete User (`DeleteUserDialog`, already exists), Cancel Work Session
  (the inline "type a reason + Confirm Cancel Session" step in
  `session-history-modal.tsx`, already exists), Deactivate Worker, Archive
  Record. If you're adding a new destructive action, require a distinct
  confirm step (typed reason, a second click, or a dedicated dialog) before
  it can fire — never a single click straight to the mutation.
- **Error toast** — normal recoverable errors reached via a redirect
  (`?error=<code>`): validation failures, "not enough stock", "materials
  pending", "active work session exists". Map the code in `ERROR_MAP`.
- **Warning modal** — only when the user must actively decide between two
  outcomes (discard unsaved changes, override a check). `LargeFormModal`'s
  existing "Discard changes?" confirm-on-close already does this — reuse
  that pattern rather than inventing a new one.

## Accessibility (Task 9)

- Modal: focus moves to the primary action on open, `Escape` closes, a
  visible X close button always exists, every action is a real `<a>`/
  `<button>` (keyboard reachable), `role="dialog"` + `aria-modal="true"` +
  `aria-labelledby`.
- Toast: `role="status"`/`aria-live="polite"` for success/info,
  `role="alert"`/`aria-live="assertive"` for error/warning, never moves
  focus (doesn't interrupt what the user was doing), always has a visible
  close button.

## Responsive (Task 10)

- Modal: `max-w-[560px]` with `p-4` viewport padding and `max-h-[90vh]` +
  internal scroll, so it's never taller than the screen on mobile. Buttons
  are `flex-col` (stacked, full-width) by default and become a `sm:flex-row`
  row once there's room.
- Toast: capped at `max-w-[380px]`, anchored bottom-right on `sm:` and
  above, full-width-minus-padding and centered above the fixed mobile bottom
  nav bar (`bottom-[calc(5.5rem+env(safe-area-inset-bottom))]`) below `sm:` —
  never overlapping the nav or a page's own bottom action buttons.

## Found and fixed (Task 8 audit)

- `ActionToast` was previously a full-screen, backdrop-blurred, centered
  card — functionally a second modal system, not a toast (see the long-
  standing comment in `notification-toast-center.tsx` that already called
  this out). Redesigned to the compact corner card described above.
- Seven near-identical hand-rolled "success modal" components (Job Card
  Created/Submitted/Closed/Opened, Correction Sent, Materials Request
  Created, Materials Received) had converged on the same markup
  independently, with one visible drift: some used a boxed "Next
  Recommended Step" panel, others a plain "**Next:** ..." inline line.
  Consolidated onto the shared `WorkflowSuccessModal` (boxed panel style)
  — same external props/call sites, zero behavior change.
- Several `?error=<code>` values produced by `app/actions/files.ts` (
  `no-file`, `file-upload-failed`, `file-metadata-failed`,
  `upload-permission`, `delete-permission`), `app/actions/asset-categories.ts`,
  `app/actions/phase4.ts`, and a few `app/actions/user-access.ts` codes had
  no `ERROR_MAP` entry — they fell through to a bare "Error" title with the
  raw code as description. Added proper entries.
- The generic unmapped-error fallback said just "Error" — changed to
  "Action could not be completed" (matching the wording the Job Card detail
  page's own inline error banner already used) so an unmapped code still
  reads naturally.
- Work Session Start/Pause/Stop/Resume, Manual Time Entry, Session Edit/
  Cancel, and Worker Profile Save gave **no success feedback at all**
  (silent re-render on success, only an inline error on failure) — added
  `dispatchActionToast(...)` calls.
- **Found, not fixed (documented, not touched — out of this unit's safe
  scope):** the Job Card detail page has its own inline error banner
  (`errorMessage`/`humanizeError()`) reading the same `?error=` param
  `ActionToast` also reads, so a workflow error can show twice (banner +
  toast) on that one page. `humanizeError()` there is also a second,
  page-local error-code-to-text map that duplicates part of `ERROR_MAP`.
  Fixing this cleanly means either removing that page's own banner (risks
  losing its one special case — the "Open Existing Materials Request" link
  shown only for the duplicate-request error) or teaching the global toast
  to suppress itself per-page, and neither is a small, safe change — left
  as a known follow-up rather than rewritten under time pressure.
