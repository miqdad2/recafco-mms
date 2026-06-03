import QRCode from "qrcode";

export async function createQrSvg(value: string) {
  return QRCode.toString(value, {
    type: "svg",
    margin: 1,
    width: 160,
    color: {
      dark: "#111827",
      light: "#FFFFFF"
    }
  });
}

export function internalQrTarget(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}
