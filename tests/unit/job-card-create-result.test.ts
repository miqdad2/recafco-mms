// Job Card Creation Reliability unit tests — run with `npm run test:unit`.
// The submission id is what makes a retried New Job Card idempotent, so the
// wizard must always produce one the server accepts, including on plain
// http (no crypto.randomUUID) on the factory network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSubmissionId, newSubmissionId } from "@/lib/work-orders/job-card-create-result";

describe("newSubmissionId", () => {
  it("produces ids the server accepts", () => {
    for (let i = 0; i < 200; i++) assert.ok(isSubmissionId(newSubmissionId()));
  });

  it("produces a different id for each new Job Card", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newSubmissionId()));
    assert.equal(ids.size, 1000);
  });

  it("still works where crypto.randomUUID is unavailable (insecure context)", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const id = newSubmissionId();
      assert.ok(isSubmissionId(id), id);
      // RFC 4122 version 4 / variant bits.
      assert.equal(id[14], "4");
      assert.ok("89ab".includes(id[19]!));
      assert.notEqual(newSubmissionId(), id);
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, "randomUUID", original);
      else delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    }
  });
});

describe("isSubmissionId", () => {
  it("rejects anything that is not a uuid", () => {
    for (const bad of [undefined, null, "", "abc", 42, "00000000-0000-0000-0000-00000000000", "x".repeat(36), {}]) {
      assert.equal(isSubmissionId(bad), false, String(bad));
    }
  });
});
