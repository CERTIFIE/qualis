import { realpath } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { BROWSE_ROOT, store } from "@/lib/data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Rename (`name`) and/or add registered projects (`add`, moved out of any other solution). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const id = decodeURIComponent((await params).id);
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; add?: unknown };
  const s = store();
  if (!(await s.solution(id))) return NextResponse.json({ status: "not-found" }, { status: 404 });
  if (typeof body.name === "string" && body.name.trim()) await s.renameSolution(id, body.name);
  if (Array.isArray(body.add)) await s.addToSolution(id, body.add.filter((k): k is string => typeof k === "string"));
  const solution = await s.solution(id);
  return NextResponse.json({ status: "ok", id, name: solution?.name, projects: solution?.projects.length ?? 0 });
}

/** Look for new projects below the solution's folder. */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const id = decodeURIComponent((await params).id);
  const result = await store().rescanSolution(await realpath(BROWSE_ROOT), id);
  return NextResponse.json(result, { status: result.status === "not-found" ? 404 : 200 });
}

/** Remove solution: only the grouping is forgotten; its projects stay and no file is touched. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const id = decodeURIComponent((await params).id);
  const removed = await store().removeSolution(id);
  return NextResponse.json({ status: removed ? "removed" : "not-found" }, { status: removed ? 200 : 404 });
}
