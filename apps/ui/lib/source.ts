import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { FileReport } from "@qualis/schema";

// Where the file view gets the code from: the source embedded in the report, or the file in the project folder,
// compared with the `sha256` the analyzer recorded (UTF-8 content without BOM).

export type SourceResult =
  | { mode: "embedded"; text: string }
  | { mode: "disk"; text: string; path: string; verified: true }
  | { mode: "disk-unverified"; text: string; path: string }
  | { mode: "changed"; text: string; path: string }
  | { mode: "missing"; path: string; reason: "not-found" | "outside" | "too-large" | "binary" }
  | { mode: "no-folder" };

export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** SHA-256 hex of text as the analyzer computes it: UTF-8, without a leading byte order mark. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, "utf8").digest("hex");
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const isInside = (root: string, target: string) => target === root || target.startsWith(root + path.sep);

export async function resolveSource(file: FileReport, folder: string | null): Promise<SourceResult> {
  if (typeof file.source === "string") return { mode: "embedded", text: file.source };
  if (!folder) return { mode: "no-folder" };
  const target = path.resolve(/*turbopackIgnore: true*/ folder, file.path);
  let realFolder: string;
  let real: string;
  try {
    realFolder = await realpath(folder);
    real = await realpath(target);
  } catch {
    return { mode: "missing", path: target, reason: "not-found" };
  }
  if (!isInside(realFolder, real)) return { mode: "missing", path: target, reason: "outside" };
  const info = await stat(real);
  if (!info.isFile()) return { mode: "missing", path: target, reason: "not-found" };
  if (info.size > MAX_SOURCE_BYTES) return { mode: "missing", path: target, reason: "too-large" };
  const handle = await open(real, "r");
  let buffer: Buffer;
  try {
    buffer = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (buffer.subarray(0, 8000).includes(0)) return { mode: "missing", path: target, reason: "binary" };
  const text = stripBom(buffer.toString("utf8"));
  if (!file.sha256) return { mode: "disk-unverified", text, path: target };
  return contentHash(text) === file.sha256.toLowerCase() ? { mode: "disk", text, path: target, verified: true } : { mode: "changed", text, path: target };
}
