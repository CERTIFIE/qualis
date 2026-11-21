import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

/** Move to solution (`id`), to a new solution (`newName`), or out of its solution (`id: null`). */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const key = decodeURIComponent((await params).key);
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; newName?: unknown };
  const target = typeof body.newName === "string" && body.newName.trim() ? { newName: body.newName.trim() } : { id: typeof body.id === "string" ? body.id : null };
  const result = await store().moveProject(key, target);
  return NextResponse.json(result, { status: result.status === "ok" ? 200 : 404 });
}
