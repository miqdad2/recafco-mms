// Page-header Back — visited-page list and where Back goes.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_PAGE_HISTORY, backTarget, isInternalPath, recordPageVisit } from "@/lib/navigation/page-history";

const visit = (...urls: string[]) => urls.reduce<string[]>((entries, url) => recordPageVisit(entries, url), []);

describe("isInternalPath", () => {
  it("accepts same-site paths only", () => {
    assert.equal(isInternalPath("/maintenance/work-orders?status=Closed"), true);
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "", null, 42]) {
      assert.equal(isInternalPath(bad), false, String(bad));
    }
  });
});

describe("recordPageVisit", () => {
  it("adds a new page", () => {
    assert.deepEqual(visit("/dashboard", "/maintenance/work-orders"), ["/dashboard", "/maintenance/work-orders"]);
  });

  it("replaces the entry when only the query changes (filters, tabs, modals)", () => {
    assert.deepEqual(
      visit("/dashboard", "/maintenance/work-orders", "/maintenance/work-orders?status=Closed", "/maintenance/work-orders?status=Closed&new_job_card=1"),
      ["/dashboard", "/maintenance/work-orders?status=Closed&new_job_card=1"]
    );
  });

  it("pops when arriving back at the previous page (no A → B → A ping-pong)", () => {
    assert.deepEqual(visit("/dashboard", "/maintenance/work-orders?q=pump", "/maintenance/work-orders/1", "/maintenance/work-orders?q=pump"), [
      "/dashboard",
      "/maintenance/work-orders?q=pump",
    ]);
  });

  it("refresh (same URL) changes nothing", () => {
    assert.deepEqual(visit("/dashboard", "/assets", "/assets"), ["/dashboard", "/assets"]);
  });

  it("ignores non-internal values and stays bounded", () => {
    assert.deepEqual(recordPageVisit(["/dashboard"], "//evil.example"), ["/dashboard"]);
    const many = Array.from({ length: MAX_PAGE_HISTORY + 10 }, (_, i) => `/page-${i}`);
    assert.equal(visit(...many).length, MAX_PAGE_HISTORY);
  });
});

describe("backTarget", () => {
  it("returns the previous page with its filters", () => {
    const entries = visit("/maintenance/daily-activity?status=paused", "/maintenance/work-orders/1");
    assert.equal(backTarget(entries, "/maintenance/work-orders/1", "/maintenance/work-orders"), "/maintenance/daily-activity?status=paused");
  });

  it("uses the fallback when opened directly / first page in the tab", () => {
    assert.equal(backTarget(visit("/maintenance/work-orders/1"), "/maintenance/work-orders/1", "/maintenance/work-orders"), "/maintenance/work-orders");
    assert.equal(backTarget([], "/store/parts-requests", "/dashboard"), "/dashboard");
  });

  it("never returns an external or tampered entry", () => {
    assert.equal(backTarget(["https://evil.example", "/assets"], "/assets", "/dashboard"), "/dashboard");
    assert.equal(backTarget(["//evil.example", "/assets"], "/assets", "/dashboard"), "/dashboard");
  });

  it("returns the last entry when the current page is not recorded yet", () => {
    assert.equal(backTarget(["/dashboard", "/assets"], "/reports", "/dashboard"), "/assets");
  });
});
