// Integration-test module hooks: the unit-test hooks ("@/..." alias,
// extensionless .ts, "server-only" stub) plus extensionless Next.js
// subpaths ("next/navigation" → "next/navigation.js"), which server
// modules such as lib/auth/context.ts import and plain Node ESM cannot
// resolve on its own. Nothing from them is called by the tests.
import { register } from "node:module";

register("../unit/resolve-hooks.mjs", import.meta.url);
register("./next-hooks.mjs", import.meta.url);
