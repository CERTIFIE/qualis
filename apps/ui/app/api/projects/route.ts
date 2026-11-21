import { realpath } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { resolveInRoot } from "@/lib/browse";
import { BROWSE_ROOT, store } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await store().scan();
  return NextResponse.json(snapshot.projects.map((p) => ({ key: p.key, name: p.name, folder: p.folder, analyses: p.analyses.length, uploads: p.uploads, solution: p.solution })));
}

/** Import project: registers a folder inside QUALIS_BROWSE_ROOT (or links it to the uploaded project with its key). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { path?: unknown };
  if (typeof body.path !== "string") return NextResponse.json({ status: "error", message: "path is required" }, { status: 400 });
  const resolved = await resolveInRoot(await realpath(BROWSE_ROOT), body.path);
  if (!resolved.ok) return NextResponse.json({ status: resolved.reason }, { status: 400 });
  const result = await store().importFolder(resolved.path);
  return NextResponse.json(result, { status: result.status === "no-qualis" || result.status === "conflict" ? 409 : 200 });
}
