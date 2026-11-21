import { NextResponse, type NextRequest } from "next/server";
import { MAX_UPLOAD_BYTES, store } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Read analysis: the body is a report.json. With ?dryRun=1 nothing is saved and the response says what would happen
 * (creates a project, adds to one, already present, invalid); without it the analysis is stored in the data folder.
 */
export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return tooLarge();
  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) return tooLarge();
  const text = buffer.toString("utf8").replace(/^﻿/, "");
  const s = store();
  const result = request.nextUrl.searchParams.get("dryRun") === "1" ? await s.preview(text) : await s.upload(text);
  // Validation outcomes (including "invalid") are answers, not errors: the dialog shows them.
  return NextResponse.json(result);
}

function tooLarge() {
  return NextResponse.json({ status: "invalid", errors: [`The file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`] }, { status: 413 });
}
