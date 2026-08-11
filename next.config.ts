import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
];

const nextConfig: NextConfig = {
  typedRoutes: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      },
      {
        // Attachment Preview URL Fix Unit 10G.29: the private file-serving
        // route (app/api/files/[bucket]/[...path]/route.ts) is the source
        // the Attachment Preview modal's PDF <iframe> loads from — the
        // blanket X-Frame-Options: DENY above blocks ALL framing of it,
        // even by this same app's own pages, which is what actually
        // produced "localhost refused to connect" (Chrome's exact wording
        // for content blocked by X-Frame-Options). The URL itself was
        // already a same-origin relative path (/api/files/...), so no
        // amount of URL rewriting would have fixed this — only the header
        // policy needed to change. Overriding to SAMEORIGIN here (Next.js
        // applies the later-matching header when two rules set the same
        // key for the same path) still blocks every third-party site from
        // framing/hotlinking these private files; it only allows this
        // app's own pages — on whichever origin they're served from,
        // localhost:3000 in dev or http://192.168.1.17:81 deployed — to
        // embed them, which is exactly the preview modal's use case.
        source: "/api/files/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }]
      }
    ];
  }
};

export default nextConfig;
