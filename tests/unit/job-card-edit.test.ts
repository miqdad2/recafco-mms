// Job Card Open / Closed Date rules, editable statuses and the edit audit
// diff — run with `npm run test:unit`. The wizard, the shared form schema,
// the edit action, the detail page, print and Daily Activity all use these.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkJobCardDateRange,
  diffJobCardEdit,
  formatJobCardDate,
  isIsoDate,
  isJobCardEditable,
  JOB_CARD_DATE_MESSAGES,
  JOB_CARD_EDIT_AUDIT_FIELDS,
  lineItemsUnchanged,
  readJobCardEditChanges,
  toIsoDateOnly,
  type JobCardEditSnapshot,
} from "@/lib/work-orders/job-card-edit";

function snapshot(overrides: Partial<JobCardEditSnapshot> = {}): JobCardEditSnapshot {
  const base = Object.fromEntries(JOB_CARD_EDIT_AUDIT_FIELDS.map(([field]) => [field, null])) as JobCardEditSnapshot;
  return { ...base, ...overrides };
}

describe("Job Card Open / Closed Date range", () => {
  it("both dates are optional", () => {
    assert.equal(checkJobCardDateRange("", ""), null);
    assert.equal(checkJobCardDateRange(null, undefined), null);
    assert.equal(checkJobCardDateRange("2026-10-27", ""), null);
  });

  it("End Date on or after Start Date is allowed (same day too)", () => {
    assert.equal(checkJobCardDateRange("2026-10-27", "2026-10-27"), null);
    assert.equal(checkJobCardDateRange("2026-10-27", "2026-11-02"), null);
    assert.equal(checkJobCardDateRange("2026-12-31", "2027-01-01"), null);
  });

  it("End Date before Start Date is refused on the End Date", () => {
    assert.deepEqual(checkJobCardDateRange("2026-10-27", "2026-10-26"), {
      field: "job_card_end_date",
      message: JOB_CARD_DATE_MESSAGES.endBeforeStart,
    });
  });

  it("End Date without Start Date asks for the Start Date", () => {
    assert.deepEqual(checkJobCardDateRange("", "2026-10-27"), {
      field: "job_card_start_date",
      message: JOB_CARD_DATE_MESSAGES.endWithoutStart,
    });
  });

  it("impossible or malformed dates are refused", () => {
    assert.equal(checkJobCardDateRange("2026-02-30", "")?.field, "job_card_start_date");
    assert.equal(checkJobCardDateRange("2026-10-27", "27/10/2026")?.field, "job_card_end_date");
    assert.equal(isIsoDate("2028-02-29"), true);
    assert.equal(isIsoDate("2026-02-29"), false);
    assert.equal(isIsoDate("2026-10-27T10:00"), false);
  });
});

describe("Job Card date display", () => {
  it("shows a stored @db.Date as the same calendar day, with no time-zone shift", () => {
    // @db.Date comes back from Prisma as UTC midnight.
    assert.equal(formatJobCardDate(new Date("2026-10-27T00:00:00.000Z")), "27 Oct 2026");
    assert.equal(formatJobCardDate("2026-01-05"), "5 Jan 2026");
    assert.equal(toIsoDateOnly(new Date("2026-10-27T00:00:00.000Z")), "2026-10-27");
  });

  it('shows "Not entered" when empty, never an invented date', () => {
    assert.equal(formatJobCardDate(null), "Not entered");
    assert.equal(formatJobCardDate(undefined), "Not entered");
    assert.equal(formatJobCardDate(""), "Not entered");
    assert.equal(formatJobCardDate("not a date"), "Not entered");
    assert.equal(formatJobCardDate(null, ""), "");
  });
});

describe("Job Card editable until closure is requested", () => {
  it("allows the open statuses", () => {
    for (const status of ["Created", "Under Review", "Approved", "In Progress", "Waiting Materials"]) {
      assert.equal(isJobCardEditable(status), true, status);
    }
  });

  it("refuses once closure is requested, and after", () => {
    for (const status of ["Closure Requested", "Closed", "Cancelled", "Rejected"]) {
      assert.equal(isJobCardEditable(status), false, status);
    }
  });
});

describe("Edit form line items are kept when untouched", () => {
  const a = ["engine oil", null, 1, "litter", null];
  const b = ["oil filter", "OF-1", 2, "PCS", null];
  const c = ["gasket", null, 4, "PCS", "spare"];

  it("the same rows posted back → unchanged", () => {
    assert.equal(lineItemsUnchanged([a, b], [a, b], 8), true);
    assert.equal(lineItemsUnchanged([], [], 3), true);
  });

  it("rows beyond the form's slots are not a change (they were never shown)", () => {
    // 3 existing attachments, the form shows 2 and posts those 2 back.
    assert.equal(lineItemsUnchanged([a, b], [a, b, c], 2), true);
  });

  it("an edited, removed or added row → changed", () => {
    assert.equal(lineItemsUnchanged([a, ["oil filter", "OF-1", 3, "PCS", null]], [a, b], 8), false);
    assert.equal(lineItemsUnchanged([a], [a, b], 8), false);
    assert.equal(lineItemsUnchanged([a, b, c], [a, b], 8), false);
    assert.equal(lineItemsUnchanged([b, a], [a, b], 8), false);
  });
});

describe("Job Card edit audit diff", () => {
  it("records only the fields that changed, with old and new values", () => {
    const before = snapshot({ ordered_by: "Ahmed", date_of_order: "26 Oct 2026" });
    const after = snapshot({
      ordered_by: "Ahmed",
      date_of_order: "26 Oct 2026",
      job_card_start_date: "27 Oct 2026",
      job_card_end_date: "29 Oct 2026",
    });
    assert.deepEqual(diffJobCardEdit(before, after), [
      { field: "job_card_start_date", label: "Job Card Open Date", from: "Not entered", to: "27 Oct 2026" },
      { field: "job_card_end_date", label: "Job Card Closed Date", from: "Not entered", to: "29 Oct 2026" },
    ]);
  });

  it("clearing a date is recorded as → Not entered", () => {
    const changes = diffJobCardEdit(snapshot({ job_card_end_date: "29 Oct 2026" }), snapshot());
    assert.deepEqual(changes, [{ field: "job_card_end_date", label: "Job Card Closed Date", from: "29 Oct 2026", to: "Not entered" }]);
  });

  it("an unchanged save records nothing; blank and null are the same", () => {
    assert.deepEqual(diffJobCardEdit(snapshot({ notes: "" }), snapshot({ notes: null })), []);
    assert.deepEqual(diffJobCardEdit(snapshot({ notes: " x " }), snapshot({ notes: "x" })), []);
  });

  it("never lists a cost field", () => {
    const fields: string[] = JOB_CARD_EDIT_AUDIT_FIELDS.map(([field]) => field);
    for (const costField of ["total_labor_cost", "total_material_cost", "total_work_order_cost"]) {
      assert.equal(fields.includes(costField), false, costField);
    }
  });

  it("reads changes back from audit metadata and skips anything malformed", () => {
    const good = { field: "job_card_start_date", label: "Job Card Open Date", from: "Not entered", to: "27 Oct 2026" };
    assert.deepEqual(readJobCardEditChanges({ changes: [good, { label: 1 }, null] }), [good]);
    assert.deepEqual(readJobCardEditChanges({ status: "(preserved)" }), []);
    assert.deepEqual(readJobCardEditChanges(null), []);
  });

  it("shows history saved under the old date labels with the current labels", () => {
    const stored = [
      { field: "job_card_start_date", label: "Job Card Start Date", from: "Not entered", to: "27 Oct 2026" },
      { field: "job_card_end_date", label: "Job Card End Date", from: "Not entered", to: "29 Oct 2026" },
      { field: "retired_field", label: "Old label", from: "a", to: "b" },
    ];
    assert.deepEqual(
      readJobCardEditChanges({ changes: stored }).map((c) => c.label),
      ["Job Card Open Date", "Job Card Closed Date", "Old label"]
    );
    assert.equal(stored[0].label, "Job Card Start Date");
  });
});
