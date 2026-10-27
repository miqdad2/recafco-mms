// Job Card deletion eligibility (client-safe, pure).
//
// A Job Card can be deleted only while nothing has been recorded against it
// that another record, stock balance or cost depends on. Anything recorded
// needs its own correction process instead (cancel the work period, return
// the stock, finish the Materials Request), so it blocks deletion here.
// Evaluated when Data Entry asks and again, inside the approval transaction,
// when the Manager approves (lib/backend/work-orders/job-card-deletion.ts).

export type JobCardDeletionFacts = {
  status: string;
  deleted: boolean;
  workSessionCount: number; // non-cancelled work periods (any worker)
  materialsRequestNumbers: string[];
  stockMovementCount: number; // offline inventory (not deleted) + legacy inventory movements
  materialsUsedCount: number; // work_order_materials "Record Material Used" rows
  purchaseRequestCount: number;
  laborRecordCount: number; // work_order_labor rows + technician notes with hours
  // Manual work time / corrections waiting for the Manager (optional for older callers).
  pendingTimeEntryCount?: number;
};

export type JobCardDeletionEligibility = { eligible: boolean; reasons: string[] };

export function evaluateJobCardDeletion(facts: JobCardDeletionFacts): JobCardDeletionEligibility {
  const reasons: string[] = [];

  if (facts.deleted) {
    return { eligible: false, reasons: ["This Job Card has already been deleted."] };
  }
  if (facts.status === "Closed") {
    reasons.push("This Job Card is closed. Closed Job Cards are kept as permanent records.");
  } else if (facts.status === "Closure Requested") {
    reasons.push("Closure has already been requested for this Job Card. The Manager must review the closure first.");
  }
  if (facts.workSessionCount > 0) {
    reasons.push("Worker time has been recorded on this Job Card. Recorded work hours must be kept.");
  }
  if (facts.materialsRequestNumbers.length > 0) {
    const list = facts.materialsRequestNumbers.join(", ");
    reasons.push(`This Job Card has a Materials Request (${list}). Materials Requests cannot be removed, so the Job Card must be kept.`);
  }
  if (facts.stockMovementCount > 0) {
    reasons.push("Store stock has been issued or received for this Job Card. Stock records must be kept.");
  }
  if (facts.materialsUsedCount > 0) {
    reasons.push("Materials used have been recorded on this Job Card.");
  }
  if (facts.purchaseRequestCount > 0) {
    reasons.push("A purchase request is linked to this Job Card.");
  }
  if (facts.laborRecordCount > 0) {
    reasons.push("Labor hours have been recorded on this Job Card.");
  }
  if ((facts.pendingTimeEntryCount ?? 0) > 0) {
    reasons.push("Worker time is waiting for Manager review on this Job Card. The Manager must approve or reject it first.");
  }

  return { eligible: reasons.length === 0, reasons };
}

export const DELETION_REASON_MIN_LENGTH = 5;
export const DELETION_REASON_MAX_LENGTH = 500;
