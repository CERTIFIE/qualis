import { NextResponse } from "next/server";
import { BROWSE_ROOT, store } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Liveness and a summary of the registered projects, for container health checks. */
export async function GET() {
  const snapshot = await store().scan();
  return NextResponse.json({
    status: "ok",
    dataDir: snapshot.dataDir,
    browseRoot: BROWSE_ROOT,
    projects: snapshot.projects.length,
    analyses: snapshot.projects.reduce((a, p) => a + p.analyses.length, 0),
  });
}
