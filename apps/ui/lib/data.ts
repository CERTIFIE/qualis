import "server-only";
import os from "node:os";
import path from "node:path";
import { ProjectStore } from "./store";

// QUALIS_DATA_DIR keeps the registered projects and the uploaded analyses (Docker: /data; `pnpm ui`: <repo>/.qualis-ui).
// QUALIS_BROWSE_ROOT is the only part of the disk the "Import project" folder browser can see (Docker: /workspace).
// Both are known only at run time: keep them out of the build-time file tracing.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.QUALIS_DATA_DIR ?? path.join(os.homedir(), ".qualis-ui"));
export const BROWSE_ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.QUALIS_BROWSE_ROOT ?? os.homedir());
export const MAX_UPLOAD_BYTES = Number(process.env.QUALIS_MAX_UPLOAD_MB ?? 50) * 1024 * 1024;

const globalStore = globalThis as unknown as { __qualisStore?: ProjectStore };

export function store(): ProjectStore {
  globalStore.__qualisStore ??= new ProjectStore({ dataDir: DATA_DIR, ttlMs: Number(process.env.QUALIS_SCAN_INTERVAL_MS ?? 2000) });
  return globalStore.__qualisStore;
}
