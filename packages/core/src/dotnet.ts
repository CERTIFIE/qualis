import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { relativeTo, toPosix } from "./paths.js";

/** The build error log (SARIF) of one .NET project. */
export interface ProjectErrorLog {
  /** Project file, relative to the project root. */
  project: string;
  /** Absolute path of the SARIF file. */
  file: string;
}

const PROJECT_EXTENSIONS = [".csproj", ".vbproj"];

/** Whether a path is a .NET project file. */
export function isProjectFile(file: string): boolean {
  const lower = file.toLowerCase();
  return PROJECT_EXTENSIONS.some((e) => lower.endsWith(e));
}

/**
 * Maps each file to the project that compiles it: the project file in the
 * nearest folder above it, as the SDK's default `Compile` items do.
 * Returns undefined for files that no project folder contains.
 */
export function projectOwner(projects: string[]): (file: string) => string | undefined {
  const byDir = new Map<string, string>();
  for (const p of projects) {
    const dir = path.posix.dirname(p);
    // Two project files in one folder share its sources; the first in order wins.
    if (!byDir.has(dir)) byDir.set(dir, p);
  }
  return (file) => {
    let dir = path.posix.dirname(file);
    for (;;) {
      const owner = byDir.get(dir);
      if (owner) return owner;
      if (dir === "." || dir === "/" || dir === "") return byDir.get(".");
      dir = path.posix.dirname(dir);
    }
  };
}

/** Value of the last `<ErrorLog>` element of an MSBuild file (conditions are not evaluated). */
function declaredErrorLog(xml: string): string | undefined {
  const values = [...xml.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<ErrorLog(?:\s[^>]*)?>([^<]*)<\/ErrorLog>/g)].map((m) => m[1]!.trim());
  return values.filter((v) => v !== "").pop();
}

/** The `Directory.Build.props` MSBuild imports for a project: the nearest one up to the project root. */
function directoryBuildProps(projectDir: string, baseDir: string): string | undefined {
  let dir = projectDir;
  for (;;) {
    const candidate = path.join(dir, "Directory.Build.props");
    if (existsSync(candidate)) return candidate;
    if (relativeTo(baseDir, dir) === null) return undefined;
    dir = path.dirname(dir);
  }
}

/** Expands the MSBuild properties of an `ErrorLog` value into a glob pattern (unknown properties match anything). */
function errorLogPattern(value: string, projectFile: string, declaredIn: string): string {
  const projectDir = path.dirname(projectFile);
  const known: Record<string, string> = {
    msbuildprojectdirectory: projectDir,
    projectdir: projectDir + path.sep,
    msbuildprojectname: path.basename(projectFile, path.extname(projectFile)),
    projectname: path.basename(projectFile, path.extname(projectFile)),
    msbuildprojectfile: path.basename(projectFile),
    msbuildthisfiledirectory: path.dirname(declaredIn) + path.sep,
  };
  const file = value.replace(/,\s*version\s*=.*$/i, "");
  const expanded = file.replace(/\$\(([^)]+)\)/g, (_, name: string) => known[name.toLowerCase()] ?? "*");
  // Relative paths are resolved by the compiler against the project folder.
  return toPosix(path.resolve(projectDir, expanded.replace(/\\/g, "/")));
}

/**
 * Finds the build error logs of .NET projects: the `ErrorLog` declared in the
 * project file or its `Directory.Build.props`, otherwise the `*.sarif` files of
 * the project folder (`dotnet build -p:ErrorLog=build.sarif` writes there).
 */
export async function findProjectErrorLogs(baseDir: string, projects: string[]): Promise<ProjectErrorLog[]> {
  const found: ProjectErrorLog[] = [];
  for (const project of projects) {
    const projectFile = path.join(baseDir, project);
    const projectDir = path.dirname(projectFile);
    let pattern: string | undefined;
    const own = declaredErrorLog(await readFile(projectFile, "utf8").catch(() => ""));
    if (own) pattern = errorLogPattern(own, projectFile, projectFile);
    else {
      const props = directoryBuildProps(projectDir, baseDir);
      const inherited = props ? declaredErrorLog(await readFile(props, "utf8").catch(() => "")) : undefined;
      if (inherited) pattern = errorLogPattern(inherited, projectFile, props!);
    }
    const files = pattern
      ? await fg(fg.escapePath(pattern).replace(/\\\*/g, "*"), { absolute: true, onlyFiles: true, dot: true })
      : await fg("*.sarif", { cwd: projectDir, absolute: true, onlyFiles: true, dot: true });
    for (const file of files.sort()) found.push({ project, file: path.resolve(file) });
  }
  return found;
}

/** Number of the given files modified after the error log was written. */
export async function newerThan(errorLog: string, files: string[]): Promise<number> {
  const written = (await stat(errorLog)).mtimeMs;
  let newer = 0;
  for (const file of files) {
    try {
      if ((await stat(file)).mtimeMs > written) newer++;
    } catch {
      // deleted meanwhile
    }
  }
  return newer;
}
