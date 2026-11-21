import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

/** Re-reads the project's .qualis folder and uploads now. */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const key = decodeURIComponent((await params).key);
  const s = store();
  await s.scan(true);
  const project = await s.project(key);
  if (!project) return NextResponse.json({ status: "not-found" }, { status: 404 });
  return NextResponse.json({ status: "ok", analyses: project.analyses.length });
}

/** Remove from Qualis: forgets the project and deletes Qualis' uploaded copies; the project folder is not touched. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const key = decodeURIComponent((await params).key);
  const removed = await store().remove(key);
  return NextResponse.json({ status: removed ? "removed" : "not-found" }, { status: removed ? 200 : 404 });
}
