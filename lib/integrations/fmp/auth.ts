import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

// MMS-FMP-INTEGRATION-01: server-to-server shared secret. The key lives
// only in the FMP_INTEGRATION_KEY environment variable — never in code or
// the database — and is compared as SHA-256 digests with timingSafeEqual so
// neither the key's length nor its contents leak through response timing.

export const FMP_INTEGRATION_KEY_HEADER = "x-fmp-integration-key";
export const FMP_INTEGRATION_KEY_MIN_LENGTH = 32;

export type FmpKeyCheck = "ok" | "missing" | "invalid" | "not_configured";

export function getConfiguredFmpIntegrationKey(): string | null {
  const value = process.env.FMP_INTEGRATION_KEY?.trim();
  return value ? value : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function checkFmpIntegrationKey(provided: string | null | undefined, configured: string | null): FmpKeyCheck {
  // A missing or too-short server key disables the integration entirely
  // rather than ever accepting a weak/empty secret.
  if (!configured || configured.length < FMP_INTEGRATION_KEY_MIN_LENGTH) return "not_configured";
  const candidate = provided?.trim();
  if (!candidate) return "missing";
  return timingSafeEqual(digest(candidate), digest(configured)) ? "ok" : "invalid";
}
