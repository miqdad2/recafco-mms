// Attachment security — file contents must match the declared type, and
// storage paths can never leave their bucket folder. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { getUploadRoot, resolveUploadPath } from "@/lib/files/local-storage";
import { checkFileContent } from "@/lib/files/validation";

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));
const file = (name: string, type: string, content: Uint8Array<ArrayBuffer>) => new File([content], name, { type });

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest of image");
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF");
const PDF = bytes("%PDF-1.7\n1 0 obj");
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ");
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04], "zip body");
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], "ole");
const EXE = bytes("MZ", [0x90, 0x00], "This program cannot be run in DOS mode");
const HTML = bytes("<html><script>alert(1)</script></html>");

const T = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  doc: "application/msword",
};

describe("checkFileContent", () => {
  it("accepts every supported real file", async () => {
    for (const f of [
      file("pump.png", T.png, PNG),
      file("pump.JPG", T.jpg, JPG),
      file("pump.jpeg", T.jpg, JPG),
      file("report.pdf", T.pdf, PDF),
      file("photo.webp", T.webp, WEBP),
      file("sheet.xlsx", T.xlsx, ZIP),
      file("letter.docx", T.docx, ZIP),
      file("old.xls", T.xls, OLE),
      file("renamed.xls", T.xls, ZIP),
      file("old.doc", T.doc, OLE),
      file("saved-as.doc", T.doc, bytes("{\\rtf1\\ansi")),
      // PDF signature after a few junk bytes (allowed by the PDF spec).
      file("scan.pdf", T.pdf, bytes([0x0d, 0x0a], "%PDF-1.4")),
    ]) {
      assert.equal(await checkFileContent(f), null, f.name);
    }
  });

  it("rejects disguised files: a program or web page renamed as a photo / PDF", async () => {
    for (const f of [
      file("pump.png", T.png, EXE),
      file("report.pdf", T.pdf, HTML),
      file("sheet.xlsx", T.xlsx, EXE),
      file("old.xls", T.xls, HTML),
      file("pump.jpg", T.jpg, PNG),
    ]) {
      assert.match((await checkFileContent(f)) ?? "", /is not a real .*Please attach the original file/, f.name);
    }
  });

  it("rejects a real file whose name does not match its type", async () => {
    assert.ok(await checkFileContent(file("evil.html", T.png, PNG)));
    assert.ok(await checkFileContent(file("pump.png.exe", T.png, PNG)));
    assert.ok(await checkFileContent(file("noextension", T.pdf, PDF)));
  });

  it("rejects types outside the allowed list", async () => {
    assert.match((await checkFileContent(file("a.svg", "image/svg+xml", bytes("<svg/>")))) ?? "", /Unsupported file type/);
  });
});

describe("resolveUploadPath", () => {
  const bucketRoot = path.resolve(getUploadRoot(), "work-order-files");

  it("resolves normal stored paths inside the bucket", () => {
    const p = resolveUploadPath("work-order-files", "1dc2c7e2-d2e0-4384-9721-86e685252af7/1793163813539-pump.png");
    assert.ok(p.startsWith(bucketRoot + path.sep), p);
  });

  it("refuses anything that could leave the bucket", () => {
    for (const bad of [
      "../work-order-files-old/x.png", // sibling with the same prefix
      "../asset-files/a/b.pdf",
      "a/../../.env",
      "a/..\\..\\.env",
      "C:/Windows/win.ini",
      "a/C:\\x",
      "./a.png",
      "a/b\u0000.png",
      "",
    ]) {
      assert.throws(() => resolveUploadPath("work-order-files", bad), /Invalid upload path/, JSON.stringify(bad));
    }
  });
});
