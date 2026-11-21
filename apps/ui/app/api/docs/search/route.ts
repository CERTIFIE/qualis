import { NextResponse } from "next/server";
import { docsSearch } from "@/lib/docs";

export const dynamic = "force-dynamic";

/** The search index of the documentation (pages and rules), for the header search on /docs pages. */
export async function GET() {
  return NextResponse.json(await docsSearch(), { headers: { "cache-control": "public, max-age=300" } });
}
