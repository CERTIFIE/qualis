import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await store().scan();
  return NextResponse.json(snapshot.solutions.map((s) => ({ id: s.id, name: s.name, folder: s.folder, projects: s.projects })));
}

/** New solution: a name and registered projects (which leave any other solution). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; projects?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ status: "error", message: "name is required" }, { status: 400 });
  const projects = Array.isArray(body.projects) ? body.projects.filter((k): k is string => typeof k === "string") : [];
  const created = await store().createSolution(name, projects);
  return NextResponse.json({ status: "created", id: created.id, name: created.name, projects: created.projects.length });
}
