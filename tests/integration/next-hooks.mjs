const NEXT_SUBPATH = /^next\/(navigation|headers|cache|server)$/;

export async function resolve(specifier, context, nextResolve) {
  if (NEXT_SUBPATH.test(specifier)) return nextResolve(`${specifier}.js`, context);
  return nextResolve(specifier, context);
}
