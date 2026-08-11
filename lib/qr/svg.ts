import QRCode from "qrcode";

// QR content is deterministic per URL (internal route + configured app base
// URL never change at runtime), but this page can be re-rendered every few
// seconds by AutoRefresh/RealtimeRefresh — caching avoids redoing the same
// QR encode on every refresh. Keyed by target URL, unbounded but naturally
// capped by the number of distinct internal routes ever rendered.
const qrSvgCache = new Map<string, string>();

export async function createQrSvg(value: string) {
  const cached = qrSvgCache.get(value);
  if (cached) return cached;

  const svg = await QRCode.toString(value, {
    type: "svg",
    margin: 1,
    width: 160,
    color: {
      dark: "#111827",
      light: "#FFFFFF"
    }
  });
  qrSvgCache.set(value, svg);
  return svg;
}

export function internalQrTarget(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}
