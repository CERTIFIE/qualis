import path from "node:path";
import { realpath } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { discoverProjects, listFolder, resolveInRoot } from "@/lib/browse";
import { BROWSE_ROOT, store } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Folder browser of "Import project": directories below QUALIS_BROWSE_ROOT only. */
export async function GET(request: NextRequest) {
  let root: string;
  try {
    root = await realpath(BROWSE_ROOT);
  } catch {
    return NextResponse.json({ error: "root-missing", root: BROWSE_ROOT }, { status: 500 });
  }
  const resolved = await resolveInRoot(root, request.nextUrl.searchParams.get("path") ?? "");
  if (!resolved.ok) return NextResponse.json({ root, error: resolved.reason });
  const dir = resolved.path;
  const registry = store().registry;
  const rel = path.relative(root, dir);
  const segments = rel ? rel.split(path.sep) : [];
  return NextResponse.json({
    root,
    path: dir,
    parent: dir === root ? null : path.dirname(dir),
    crumbs: [{ name: path.basename(root) || root, path: root }, ...segments.map((name, i) => ({ name, path: path.join(root, ...segments.slice(0, i + 1)) }))],
    entries: await Promise.all(
      (await listFolder(root, dir)).map(async (e) => ({
        ...e,
        imported: (await registry.byFolder(e.path))?.key ?? null,
        solution: (await registry.solutionByFolder(e.path))?.name ?? null,
        // Project folders a few levels down, for the "N projects inside" hint (kept cheap with a small budget).
        inner: e.qualis ? 0 : (await discoverProjects(root, e.path, { maxDepth: 3, maxFolders: 150, includeSelf: false })).length,
      })),
    ),
    status: await store().folderStatus(dir),
    solution: (await registry.solutionByFolder(dir)) ?? null,
    // Projects below the folder, offered as a solution (never at the browse root).
    discovered: await Promise.all(
      (await discoverProjects(root, dir)).map(async (d) => {
        const imported = await registry.byFolder(d.path);
        const solution = imported ? await registry.solutionOf(imported.key) : undefined;
        return { path: d.path, rel: d.rel, analyses: d.qualis.analyses, name: (await store().folderProject(d.path))?.name ?? null, imported: imported ? { key: imported.key, name: imported.name } : null, solution: solution ? { id: solution.id, name: solution.name } : null };
      }),
    ),
  });
}
