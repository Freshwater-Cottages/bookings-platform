import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session-guards";
import fs from "fs/promises";
import path from "path";

const IMAGES_ROOT = path.join(process.cwd(), "public", "images");

/** Resolve a client-supplied relative path safely inside IMAGES_ROOT. */
function safeResolve(rel: string): string | null {
  const normalized = path.normalize(rel);
  const resolved = path.resolve(IMAGES_ROOT, normalized);
  if (
    resolved !== IMAGES_ROOT &&
    !resolved.startsWith(IMAGES_ROOT + path.sep)
  ) {
    return null;
  }
  return resolved;
}

async function collectDirs(absDir: string, relBase: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      result.push(rel);
      const children = await collectDirs(path.join(absDir, entry.name), rel);
      result.push(...children);
    }
  }
  return result;
}

// GET /api/admin/image-manager/directories – list all directories
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  await fs.mkdir(IMAGES_ROOT, { recursive: true });
  const dirs = await collectDirs(IMAGES_ROOT, "");
  return NextResponse.json({ directories: ["", ...dirs] });
}

// POST /api/admin/image-manager/directories – create a new directory
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name =
    body !== null &&
    typeof body === "object" &&
    "name" in body &&
    typeof (body as Record<string, unknown>).name === "string"
      ? (body as Record<string, string>).name.trim()
      : "";
  const parent =
    body !== null &&
    typeof body === "object" &&
    "parent" in body &&
    typeof (body as Record<string, unknown>).parent === "string"
      ? (body as Record<string, string>).parent
      : "";

  if (!name || /[/\\<>:"|?*\x00-\x1F]/.test(name)) {
    return NextResponse.json(
      { error: "Invalid directory name" },
      { status: 400 },
    );
  }

  const parentAbs = safeResolve(parent);
  if (!parentAbs) {
    return NextResponse.json({ error: "Invalid parent path" }, { status: 400 });
  }

  const newAbs = path.join(parentAbs, name);
  if (newAbs !== IMAGES_ROOT && !newAbs.startsWith(IMAGES_ROOT + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    await fs.mkdir(newAbs);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      return NextResponse.json(
        { error: "Directory already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Failed to create directory" },
      { status: 500 },
    );
  }
}

// PATCH /api/admin/image-manager/directories – rename a directory
export async function PATCH(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rel =
    body !== null &&
    typeof body === "object" &&
    "path" in body &&
    typeof (body as Record<string, unknown>).path === "string"
      ? (body as Record<string, string>).path
      : "";
  const newName =
    body !== null &&
    typeof body === "object" &&
    "newName" in body &&
    typeof (body as Record<string, unknown>).newName === "string"
      ? (body as Record<string, string>).newName.trim()
      : "";

  if (!rel) {
    return NextResponse.json(
      { error: "Cannot rename the root directory" },
      { status: 400 },
    );
  }
  if (!newName || /[/\\<>:"|?*\x00-\x1F]/.test(newName)) {
    return NextResponse.json(
      { error: "Invalid directory name" },
      { status: 400 },
    );
  }

  const oldAbs = safeResolve(rel);
  if (!oldAbs || oldAbs === IMAGES_ROOT) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const newAbs = path.join(path.dirname(oldAbs), newName);
  if (!newAbs.startsWith(IMAGES_ROOT + path.sep)) {
    return NextResponse.json(
      { error: "Invalid rename target" },
      { status: 400 },
    );
  }

  try {
    await fs.rename(oldAbs, newAbs);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to rename directory" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/image-manager/directories – delete a directory and its contents
export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rel =
    body !== null &&
    typeof body === "object" &&
    "path" in body &&
    typeof (body as Record<string, unknown>).path === "string"
      ? (body as Record<string, string>).path
      : "";

  if (!rel) {
    return NextResponse.json(
      { error: "Cannot delete the root directory" },
      { status: 400 },
    );
  }

  const absPath = safeResolve(rel);
  if (!absPath || absPath === IMAGES_ROOT) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    await fs.rm(absPath, { recursive: true });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete directory" },
      { status: 500 },
    );
  }
}
