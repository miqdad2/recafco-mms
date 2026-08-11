"use client";

import { useState } from "react";

import { DailyActivityListRow, DailyActivitySelectedPanel, type DailyActivityCardData } from "@/components/work-orders/daily-activity-card";
import { ProcessMaterialsModal } from "@/components/work-orders/daily-activity-materials-modal";
import { DailyActivityClosureModal } from "@/components/work-orders/daily-activity-closure-modal";

// Daily Activity Compact Control Board Unit 9C, Task 4/9.
//
// Owns exactly one piece of client state: which Job Card is selected. The
// page.tsx server component re-fetches and re-computes `cards` on every
// AutoRefresh/RealtimeRefresh router.refresh() tick, but THIS component
// instance is not remounted by a soft refresh — its `selectedId` state
// survives across ticks. Selection is derived (find-or-fallback) rather
// than reset in an effect, so "select first remaining active Job Card if
// the selected one disappears" (Task 9) falls out naturally: if
// `selectedId` no longer matches any card in the new list, the very next
// render just falls back to `cards[0]`.

const PANEL_ID = "daily-activity-panel";
// Matches the split layout's lg breakpoint below — under it, list and panel
// stack, so a row click should scroll the (now below-the-fold) panel into view.
const STACKED_LAYOUT_MAX_WIDTH = 1024;

export function DailyActivityBoard({ cards, canPrint }: { cards: DailyActivityCardData[]; canPrint: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = (selectedId ? cards.find((c) => c.id === selectedId) : undefined) ?? cards[0] ?? null;
  // Unified Material Processing Flow Unit 10G.23 (was two separate
  // issue/receive modal states, Unit 10D): which Job Card's Process
  // Materials modal is open, if any — client state, same pattern as
  // `selectedId` above. Always keyed off `selected` at open time so it
  // can't drift if the user re-selects a different row while the modal is
  // open (the modal itself is closed first either way).
  const [processMaterialsWorkOrderId, setProcessMaterialsWorkOrderId] = useState<string | null>(null);
  // Daily Activity Closure Request Modal with Attachments Unit 10F.6, Task
  // 1: same client-state pattern as materialsModal above — always keyed off
  // `selected` at open time, so it can't drift if the user re-selects a
  // different row while the modal is open.
  const [closureModalOpen, setClosureModalOpen] = useState(false);

  function handleSelect(id: string) {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.innerWidth < STACKED_LAYOUT_MAX_WIDTH) {
      // Task 8 — on mobile/tablet the panel renders below the list; scroll
      // it into view so selecting a row visibly does something.
      requestAnimationFrame(() => {
        document.getElementById(PANEL_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  const showMultiWorkerNotice = cards.some((c) => c.laborSummary.workers.length > 1);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,35%)_minmax(0,65%)] lg:items-start">
      {/* Left — compact list, sticky + independently scrollable on desktop
          (Task 4) so the right panel never has to compete with it for the
          viewport's remaining height. */}
      <div className="space-y-1.5 lg:sticky lg:top-3 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto lg:pr-1">
        {showMultiWorkerNotice ? (
          <p className="px-0.5 text-[11px] font-semibold text-[#6B7280]">Worker timers are tracked individually.</p>
        ) : null}
        {cards.map((c) => (
          <DailyActivityListRow key={c.id} card={c} isSelected={selected?.id === c.id} onSelect={() => handleSelect(c.id)} />
        ))}
      </div>

      {/* Right — the one selected Job Card's full control panel (Task 6/7).
          Task 10 — sticky + internally scrollable on desktop too, capped to
          the viewport so the page itself never has to scroll past it; on
          mobile/tablet (below lg:) it's just the next block in normal flow. */}
      <div id={PANEL_ID} className="scroll-mt-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto">
        {selected ? (
          <DailyActivitySelectedPanel
            card={selected}
            canPrint={canPrint}
            onProcessMaterials={() => setProcessMaterialsWorkOrderId(selected.id)}
            onRequestClosure={() => setClosureModalOpen(true)}
          />
        ) : null}
      </div>

      {processMaterialsWorkOrderId ? (
        <ProcessMaterialsModal workOrderId={processMaterialsWorkOrderId} onClose={() => setProcessMaterialsWorkOrderId(null)} />
      ) : null}

      {closureModalOpen && selected ? (
        <DailyActivityClosureModal card={selected} onClose={() => setClosureModalOpen(false)} />
      ) : null}
    </div>
  );
}
