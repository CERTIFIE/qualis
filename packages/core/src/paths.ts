import path from "node:path";

/** Converts a path to forward slashes. */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Path of `absolute` relative to `baseDir`, with forward slashes; null when outside baseDir. */
export function relativeTo(baseDir: string, absolute: string): string | null {
  const rel = path.relative(baseDir, absolute);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

/** Ordinal (code unit) string comparison: deterministic regardless of the system locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
