// Final Integration Review — shared date displays and the typed date-time
// round trip are Kuwait time whatever the machine's own time zone is.
// This Windows machine is itself on Kuwait time and Node on Windows ignores
// the TZ variable, so output checks alone cannot tell "explicit Kuwait" from
// "the machine's zone" — the first test therefore checks the formatter
// options themselves.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDate, formatDateTime, formatExactDateTime } from "@/lib/utils";
import { parseKuwaitInputValue, toKuwaitInputValue } from "@/lib/format/kuwait-time";

describe("shared date displays use Asia/Kuwait", () => {
  it("every shared formatter asks Intl for Asia/Kuwait explicitly", () => {
    const seen: (string | undefined)[] = [];
    const Original = Intl.DateTimeFormat;
    const Spy = function (this: unknown, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      seen.push(options?.timeZone);
      return new Original(locales, options);
    } as unknown as typeof Intl.DateTimeFormat;
    Intl.DateTimeFormat = Spy;
    try {
      formatDateTime("2026-10-25T21:30:00.000Z");
      formatDate("2026-10-26T00:00:00.000Z");
      formatExactDateTime("2026-10-25T21:30:00.000Z");
    } finally {
      Intl.DateTimeFormat = Original;
    }
    assert.deepEqual(seen, ["Asia/Kuwait", "Asia/Kuwait", "Asia/Kuwait"]);
  });

  it("formatDateTime shows Kuwait wall-clock time across midnight", () => {
    // 21:30 UTC on 25 Oct = 00:30 on 26 Oct in Kuwait.
    const text = formatDateTime("2026-10-25T21:30:00.000Z");
    assert.match(text, /Oct 26, 2026/);
    assert.match(text, /12:30\sAM/);
  });

  it("formatDate keeps a @db.Date value on its own calendar day", () => {
    // A DATE column arrives as UTC midnight.
    assert.equal(formatDate("2026-10-26T00:00:00.000Z"), "Oct 26, 2026");
    assert.equal(formatDate(new Date(Date.UTC(2026, 0, 1))), "Jan 1, 2026");
  });

  it("formatExactDateTime is Kuwait time", () => {
    assert.equal(formatExactDateTime("2026-10-25T21:30:00.000Z"), "26 Oct 2026, 12:30 AM");
  });
});

describe("typed date-time round trip (Job Card form, work periods)", () => {
  it("a stored instant pre-fills as Kuwait time and saves back to the same instant", () => {
    for (const iso of ["2026-10-26T11:00:00.000Z", "2026-10-25T21:30:00.000Z", "2026-12-31T22:15:00.000Z"]) {
      const prefill = toKuwaitInputValue(iso);
      const saved = parseKuwaitInputValue(prefill);
      assert.equal(saved?.toISOString(), iso, `${iso} → ${prefill} → ${saved?.toISOString()}`);
    }
  });

  it("the old pre-fill (UTC wall-clock) would have moved the value — the new one does not", () => {
    const stored = "2026-10-26T11:00:00.000Z"; // 14:00 Kuwait
    assert.equal(toKuwaitInputValue(stored), "2026-10-26T14:00");
    assert.notEqual(stored.slice(0, 16), toKuwaitInputValue(stored));
  });
});
