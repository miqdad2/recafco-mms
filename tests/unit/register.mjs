// Unit-test module hooks for `node --test` (Node 24 built-in TypeScript
// type stripping — no extra dependencies):
//   - resolves the "@/..." tsconfig path alias and extensionless .ts imports
//   - stubs "server-only", which only Next.js' bundler knows how to resolve
import { register } from "node:module";

register("./resolve-hooks.mjs", import.meta.url);
