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
  // Manager Job Card Creation and Page Crash Fix Unit 10G.74, Task 1 — root
  // cause of "This module could not load" when creating/editing a Job Card
  // (or a Materials Request) with an attachment: Next.js Server Actions
  // reject any request body over 1 MB by default, with no override
  // configured here before this unit. This app's own attachment upload
  // validation (lib/files/validation.ts's MAX_PRIVATE_FILE_SIZE, and the
  // admin-configurable app_settings.max_upload_size_mb it falls back from —
  // both default to 10 MB, capped at 100 MB by the Admin Settings form/
  // schema) already tells users a single file up to 10 MB is fine, and
  // AttachmentUploadFields (shared by the New Job Card and Materials
  // Request wizards) allows up to MAX_ATTACHMENT_ROWS (5) such files in one
  // submission — the Job Card's own attachments ride along in the SAME
  // multipart FormData POST as every other field, since attachments are
  // uploaded only after upsertWorkOrderAction's own record is created, not
  // beforehand. 60 MB comfortably covers 5 files at the realistic default
  // 10 MB cap plus multipart/form-field overhead, without raising the
  // ceiling so high that it defeats the point of having one. An admin who
  // raises max_upload_size_mb well above 10 MB per file could still exceed
  // this if multiple large files are attached in one submission — the
  // per-file "File is too large" validation error still applies correctly
  // to a single oversized file either way; this fixes the specific,
  // realistic default-configuration crash this unit reports.
  experimental: {
    serverActions: {
      bodySizeLimit: "60mb"
    }
  },
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
