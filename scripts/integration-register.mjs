// Module hooks for in-process integration scripts (e.g.
// scripts/verify-job-card-deletion-time-correction.ts): the unit-test hooks
// ("@/..." alias, "server-only" stub) plus Next.js' extensionless subpath
// imports ("next/navigation", "next/headers"), which only Next's bundler
// resolves without the ".js" suffix. "next/cache" is replaced by no-ops:
// revalidatePath needs a Next request context, and there are no pages to
// refresh in a script.
import { register } from "node:module";

const CACHE_STUB = "data:text/javascript," + encodeURIComponent("export function revalidatePath() {} export function revalidateTag() {}");

register("../tests/unit/resolve-hooks.mjs", import.meta.url);
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, n) {
        if (s === "next/cache") return { url: ${JSON.stringify(CACHE_STUB)}, shortCircuit: true };
        if (/^next\\/(navigation|headers)$/.test(s)) return n(s + ".js", c);
        return n(s, c);
      }`
    ),
  import.meta.url
);
