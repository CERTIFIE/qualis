import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The documentation shown under /docs: the pages that `pnpm docs:build` writes as data in docs/site/app (from
// docs/content and the rule metadata of the plugins). QUALIS_DOCS_DIR points elsewhere (Docker: /app/docs); the
// default is the repository's folder, seen from apps/ui (`pnpm ui`, `pnpm ui:dev`).
export const DOCS_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.QUALIS_DOCS_DIR ?? path.join(process.cwd(), "../../docs/site/app"));

export interface DocsNavGroup {
  title: string;
  icon: string;
  items: Array<{ title: string; href: string }>;
}

export interface DocsNav {
  version: string;
  groups: DocsNavGroup[];
}

export interface DocsPage {
  slug: string;
  title: string;
  description: string;
  group: string;
  /** Rendered Markdown; links are absolute /docs paths. */
  html: string;
  toc: Array<{ id: string; depth: number; text: string }>;
  wide: boolean;
  prev: { title: string; href: string } | null;
  next: { title: string; href: string } | null;
}

export interface DocsSearchEntry {
  kind: "page" | "rule";
  section: string;
  title: string;
  url: string;
  text: string;
}

// Generated files do not change while the server runs, except in development (pnpm docs:build next to pnpm ui:dev).
const cache = new Map<string, unknown>();

async function readJson<T>(file: string): Promise<T | null> {
  if (process.env.NODE_ENV === "production" && cache.has(file)) return cache.get(file) as T;
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as T;
    if (process.env.NODE_ENV === "production") cache.set(file, data);
    return data;
  } catch {
    return null;
  }
}

/** Null when the documentation has not been built. */
export const docsNav = () => readJson<DocsNav>(path.join(DOCS_DIR, "nav.json"));

export const docsSearch = async () => (await readJson<DocsSearchEntry[]>(path.join(DOCS_DIR, "search.json"))) ?? [];

/** The page of a /docs path (no segments: the introduction). Null for an unknown or unsafe path. */
export async function docsPage(segments: string[] = []): Promise<DocsPage | null> {
  const slug = segments.length ? segments.map((s) => decodeURIComponent(s)).join("/") : "index";
  if (!/^[a-z0-9-]+(\/[a-z0-9_.-]+)*$/i.test(slug) || slug.split("/").some((s) => s === "." || s === "..")) return null;
  return readJson<DocsPage>(path.join(DOCS_DIR, "pages", `${slug}.json`));
}
