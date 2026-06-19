import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_IMAGE_EXTS, resolveInImagesRoot } from "@/lib/image-storage";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
) {
  const params = await context.params;
  const parts = params.path ?? [];

  if (!parts.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const relPath = parts.join("/");
  const ext = path.extname(relPath).toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(ext)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const absPath = resolveInImagesRoot(relPath);
  if (!absPath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const buffer = await fs.readFile(absPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream",
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
