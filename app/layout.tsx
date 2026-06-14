import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "RECAFCO Maintenance Management",
  description: "Enterprise maintenance management system for RECAFCO",
  manifest: "/manifest.webmanifest",
  applicationName: "RECAFCO MMS",
  generator: "Next.js",
  keywords: ["RECAFCO", "maintenance", "work orders", "assets", "PWA"],
  formatDetection: {
    telephone: false
  },
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
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
