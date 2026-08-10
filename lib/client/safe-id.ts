// crypto.randomUUID() requires a secure context (HTTPS or localhost) and is
// not guaranteed on plain HTTP/LAN deployments — production runs over plain
// HTTP on the LAN (http://192.168.1.17:81), where it throws
// "crypto.randomUUID is not a function". This is for temporary UI row
// ids/client keys only — never use it for security tokens.
export function createClientId(prefix = "id"): string {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
