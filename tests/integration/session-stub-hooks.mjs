// Test-only module hooks that let an integration test call a real server
// action as a signed-in user. Registered by the test file itself (after the
// standard integration hooks), never by the application.
//
//   next/headers  cookies() returns globalThis.__TEST_SESSION_TOKEN as the
//                 session cookie; headers() is empty. The session row itself
//                 is real (auth_sessions), so requireUser(), permissions and
//                 the action run unchanged.
//   next/cache    revalidatePath / revalidateTag are no-ops outside Next.js.
const STUBS = {
  "next/headers": `
    export async function cookies() {
      return { get: (name) => (name === "recafco_session" && globalThis.__TEST_SESSION_TOKEN ? { name, value: globalThis.__TEST_SESSION_TOKEN } : undefined), set() {}, delete() {} };
    }
    export async function headers() { return new Headers(); }
  `,
  "next/cache": `
    export function revalidatePath() {}
    export function revalidateTag() {}
    export function unstable_cache(fn) { return fn; }
  `,
};

export async function resolve(specifier, context, nextResolve) {
  const bare = specifier.replace(/\.js$/, "");
  if (bare in STUBS) return { url: `data:text/javascript,${encodeURIComponent(STUBS[bare])}`, shortCircuit: true };
  return nextResolve(specifier, context);
}
