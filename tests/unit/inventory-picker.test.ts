// Inventory Material Selection popup: the "*/" shortcut and server-side
// filtering / paging. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INVENTORY_PICKER_PAGE_SIZE, isInventoryPickerShortcut, matchesInventorySearch, pickInventoryPage, type InventoryPickerItem } from "@/lib/store/inventory-picker";

function item(name: string, extra: Partial<InventoryPickerItem> = {}): InventoryPickerItem {
  return {
    key: `manual:${name}|PCS`,
    name,
    itemCode: null,
    partNumber: null,
    ssRecCode: null,
    category: "Filters",
    location: null,
    unit: "PCS",
    balance: 5,
    minimumStock: null,
    notes: null,
    match: {} as InventoryPickerItem["match"],
    ...extra,
  };
}

const query = { search: "", category: "", location: "", stock: "all" as const, page: 1 };

describe("Shortcut", () => {
  it("opens only when */ is the whole search text", () => {
    assert.equal(isInventoryPickerShortcut("*/"), true);
    assert.equal(isInventoryPickerShortcut(" */ "), true);
    assert.equal(isInventoryPickerShortcut("*"), false);
    assert.equal(isInventoryPickerShortcut("oil */"), false);
    assert.equal(isInventoryPickerShortcut("*/filter"), false);
    assert.equal(isInventoryPickerShortcut("1/2*/3"), false);
  });
});

describe("Search", () => {
  const filter = item("Oil Filter", { itemCode: "IT-1001", partNumber: "P-77", ssRecCode: "SS-9", category: "Filters" });

  it("matches name, Item Code, part number, SS Rec. Code and category, ignoring case", () => {
    for (const s of ["oil", "FILTER", "it-1001", "p-77", "ss-9", "filters", "filter oil"]) assert.equal(matchesInventorySearch(filter, s), true, s);
    assert.equal(matchesInventorySearch(filter, "brake"), false);
  });
});

describe("Filters and pages", () => {
  const items = [
    item("Brake Pad", { category: "Brakes", location: "A1", balance: 0 }),
    item("Air Filter", { category: "Filters", location: "B2", balance: 3 }),
    item("Oil Filter", { category: "Filters", location: "A1", balance: -1 }),
  ];

  it("filters by category, location and stock", () => {
    assert.deepEqual(pickInventoryPage(items, { ...query, category: "Filters" }).items.map((i) => i.name), ["Air Filter", "Oil Filter"]);
    assert.deepEqual(pickInventoryPage(items, { ...query, location: "A1" }).items.map((i) => i.name), ["Brake Pad", "Oil Filter"]);
    assert.deepEqual(pickInventoryPage(items, { ...query, stock: "in_stock" }).items.map((i) => i.name), ["Air Filter"]);
    assert.deepEqual(pickInventoryPage(items, { ...query, stock: "out_of_stock" }).items.map((i) => i.name), ["Brake Pad", "Oil Filter"]);
  });

  it("lists filter choices from all materials, not just the page", () => {
    const page = pickInventoryPage(items, { ...query, search: "brake" });
    assert.deepEqual(page.categories, ["Brakes", "Filters"]);
    assert.deepEqual(page.locations, ["A1", "B2"]);
  });

  it("pages 10,000+ materials and returns only one page", () => {
    const many = Array.from({ length: 10_050 }, (_, i) => item(`Material ${String(i).padStart(5, "0")}`));
    const started = Date.now();
    const page = pickInventoryPage(many, { ...query, page: 3 });
    assert.equal(page.total, 10_050);
    assert.equal(page.items.length, INVENTORY_PICKER_PAGE_SIZE);
    assert.equal(page.items[0].name, `Material ${String(2 * INVENTORY_PICKER_PAGE_SIZE).padStart(5, "0")}`);
    assert.ok(Date.now() - started < 1000);
    assert.equal(pickInventoryPage(many, { ...query, page: 99_999 }).page, page.pageCount, "a page past the end shows the last page");
  });
});
