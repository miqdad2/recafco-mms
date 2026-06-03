import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RECAFCO Enterprise Maintenance Management",
    short_name: "RECAFCO MMS",
    description: "Internal maintenance, assets, work orders, parts, purchase, finance, and reports.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F5F6F8",
    theme_color: "#ED1C24",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/recafco-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ]
  };
}
