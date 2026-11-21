import { realpath } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { resolveInRoot } from "@/lib/browse";
import { BROWSE_ROOT, store } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Import as solution: the project folders found below `path` (inside QUALIS_BROWSE_ROOT, never the root itself),
 * or only those listed in `include`, become projects grouped in one solution.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { path?: unknown; name?: unknown; include?: unknown };
  if (typeof body.path !== "string") return NextResponse.json({ status: "error", message: "path is required" }, { status: 400 });
  const root = await realpath(BROWSE_ROOT);
  const resolved = await resolveInRoot(root, body.path);
  if (!resolved.ok) return NextResponse.json({ status: resolved.reason }, { status: 400 });
  const include = Array.isArray(body.include) ? body.include.filter((p): p is string => typeof p === "string") : undefined;
  const result = await store().importSolution(root, resolved.path, typeof body.name === "string" ? body.name : "", include);
  return NextResponse.json(result, { status: result.status === "root" || result.status === "none" ? 409 : 200 });
}
