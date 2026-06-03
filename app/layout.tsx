import type { Metadata, Viewport } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "RECAFCO Maintenance Management",
  description: "Enterprise maintenance management system for RECAFCO",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/recafco-icon.svg",
    apple: "/icons/recafco-icon.svg"
  },
  appleWebApp: {
    capable: true,
    title: "RECAFCO MMS",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  themeColor: "#ED1C24",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
