// Super Admin material removal — pure decision rules (no "server-only", no
// database), shared by the removal service and its unit tests.
//
// A material is a ledger identity, so "delete" can only ever mean taking
// its registration out of Inventory Control — stock and history are never
// erased:
//   - blocked: any non-zero balance (stock, or a negative balance that needs
//     review). Stock must first leave through an existing authorized process;
//     removal never writes a hidden adjustment.
//   - archive: zero balance, but it has movement history or is referenced by
//     a Job Card / Materials Request. Hidden from Inventory Control and new
//     selections; every movement and reference stays; restorable.
//   - delete: zero balance, only its zero-quantity registration row(s), and
//     no reference anywhere. The registration rows are marked deleted
//     (deleted_at — never hard-deleted) and an audit record keeps its identity.

export type MaterialRemovalFacts = {
  balance: number;
  // Movements other than a zero-quantity, unlinked registration row.
  stockMovementCount: number;
  // Movements linked to a Job Card or a Materials Request (any type).
  linkedMovementCount: number;
  jobCardMaterialReferenceCount: number;
  materialsRequestReferenceCount: number;
  generalRequestReferenceCount: number;
  isArchived: boolean;
};

export type MaterialRemovalOutcome = "delete" | "archive" | "blocked" | "already_archived";

export type MaterialRemovalAssessment = {
  outcome: MaterialRemovalOutcome;
  reasons: string[];
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function dependencyReasons(facts: MaterialRemovalFacts): string[] {
  const reasons: string[] = [];
  if (facts.stockMovementCount > 0) reasons.push(`${plural(facts.stockMovementCount, "stock movement")} in history`);
  if (facts.linkedMovementCount > 0) reasons.push(`${plural(facts.linkedMovementCount, "movement")} linked to a Job Card or Materials Request`);
  if (facts.jobCardMaterialReferenceCount > 0) reasons.push(`Used on ${plural(facts.jobCardMaterialReferenceCount, "Job Card material line")}`);
  if (facts.materialsRequestReferenceCount > 0) reasons.push(`Used on ${plural(facts.materialsRequestReferenceCount, "Materials Request line")}`);
  if (facts.generalRequestReferenceCount > 0) reasons.push(`Used on ${plural(facts.generalRequestReferenceCount, "General Materials Request line")}`);
  return reasons;
}

export function assessMaterialRemoval(facts: MaterialRemovalFacts): MaterialRemovalAssessment {
  const reasons = dependencyReasons(facts);
  if (facts.isArchived) {
    return { outcome: "already_archived", reasons: ["Already archived", ...reasons] };
  }
  if (!Number.isFinite(facts.balance) || facts.balance !== 0) {
    const balanceReason =
      facts.balance < 0
        ? "Negative balance — review the issue/receive history first"
        : "Has stock — issue or adjust the stock through the normal process before removing";
    return { outcome: "blocked", reasons: [balanceReason, ...reasons] };
  }
  if (reasons.length > 0) return { outcome: "archive", reasons };
  return { outcome: "delete", reasons: ["Unused, zero stock, no references"] };
}

export const MAX_MATERIAL_REMOVAL_BATCH = 100;

export function removalOutcomeLabel(outcome: MaterialRemovalOutcome): string {
  const labels: Record<MaterialRemovalOutcome, string> = {
    delete: "Permanently delete",
    archive: "Archive (keeps history)",
    blocked: "Blocked",
    already_archived: "Already archived",
  };
  return labels[outcome];
}
