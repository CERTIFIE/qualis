// Builds the release artifacts into release/ (run after `pnpm build` and `pnpm --filter @qualis/docs build`):
//
//   release/npm/*.tgz           the publishable packages, renamed for GitHub Packages (@<owner>/qualis, @<owner>/qualis-core, ...)
//   release/assets/qualis-<version>.tar.gz|.zip   the qualis command with all its dependencies (no registry needed)
//   release/assets/qualis-docs-<version>.zip     the static documentation site
//   release/assets/*.tgz, SHA256SUMS.txt          copies of the npm tarballs and the checksums of every asset
//
// GitHub Packages only accepts npm packages scoped with the owner of the repository, so the @qualis/* packages are
// published as @<owner>/qualis-*. Their dependencies on each other become npm aliases
// ("@qualis/core": "npm:@<owner>/qualis-core@<version>"), so the code keeps importing @qualis/* unchanged.
//
//   node scripts/release/pack.mjs [--repo CERTIFIE/qualis]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({ options: { repo: { type: "string", default: process.env.GITHUB_REPOSITORY ?? "CERTIFIE/qualis" } } });
const [owner, repoName] = values.repo.split("/");
const scope = `@${owner.toLowerCase()}`;
const repoUrl = `https://github.com/${owner}/${repoName}`;

const OUT = path.join(root, "release");
const NPM = path.join(OUT, "npm");
const ASSETS = path.join(OUT, "assets");
const TMP = path.join(OUT, "tmp");
rmSync(OUT, { recursive: true, force: true });
for (const dir of [NPM, ASSETS, TMP]) mkdirSync(dir, { recursive: true });

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const version = readJson(path.join(root, "package.json")).version;

/** qualis -> @certifie/qualis, @qualis/core -> @certifie/qualis-core */
const githubName = (name) => (name.startsWith("@qualis/") ? `${scope}/qualis-${name.slice("@qualis/".length)}` : `${scope}/${name}`);

// 1. npm packages ------------------------------------------------------------------------------------------------
const packages = [];
for (const dir of ["packages", "plugins"]) {
  for (const name of readdirSync(path.join(root, dir))) {
    const file = path.join(root, dir, name, "package.json");
    if (!existsSync(file)) continue;
    const json = readJson(file);
    if (!json.private) packages.push({ dir: path.join(dir, name), name: json.name });
  }
}
const ours = new Set(packages.map((p) => p.name));

for (const pkg of packages) {
  const work = path.join(TMP, pkg.name.replace(/[@/]/g, "_"));
  mkdirSync(work, { recursive: true });
  // pnpm pack replaces workspace:* with the exact version.
  run("pnpm", ["pack", "--pack-destination", work], path.join(root, pkg.dir));
  const tgz = readdirSync(work).find((f) => f.endsWith(".tgz"));
  run("tar", ["-xzf", tgz], work);
  const manifestFile = path.join(work, "package", "package.json");
  const manifest = readJson(manifestFile);
  manifest.name = githubName(pkg.name);
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (ours.has(dep)) manifest[field][dep] = `npm:${githubName(dep)}@${range.replace(/^[\^~]/, "")}`;
    }
  }
  manifest.repository = { type: "git", url: `git+${repoUrl}.git`, directory: pkg.dir };
  manifest.homepage = `https://${owner.toLowerCase()}.github.io/${repoName}/`;
  manifest.bugs = { url: `${repoUrl}/issues` };
  manifest.publishConfig = { registry: "https://npm.pkg.github.com" };
  // Apache-2.0 section 4: every redistributed package carries the license and the attribution notices.
  for (const file of ["LICENSE", "NOTICE"]) cpSync(path.join(root, file), path.join(work, "package", file));
  if (Array.isArray(manifest.files)) manifest.files = [...new Set([...manifest.files, "LICENSE", "NOTICE"])];
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const packed = run("npm", ["pack", "--json", "--pack-destination", NPM, "./package"], work);
  const filename = JSON.parse(packed)[0].filename;
  cpSync(path.join(NPM, filename), path.join(ASSETS, filename));
  console.log(`npm    ${manifest.name}@${version}  ->  release/npm/${filename}`);
}

// 2. Standalone qualis command ------------------------------------------------------------------------------------
const bundleName = `qualis-${version}`;
const bundle = path.join(TMP, bundleName);
// A flat node_modules (no symlinks), so that the archive also works on Windows.
run("pnpm", ["--filter", "qualis", "deploy", "--prod", "--legacy", "--config.node-linker=hoisted", bundle]);
rmSync(path.join(bundle, "node_modules", ".bin"), { recursive: true, force: true });
for (const file of ["LICENSE", "NOTICE"]) cpSync(path.join(root, file), path.join(bundle, file));
writeFileSync(
  path.join(bundle, "README.txt"),
  `Qualis ${version}: the qualis command with all its dependencies.

Requirements: Node.js 20.19 or later. Optional: .NET SDK 10 for the Roslyn rule pack.

Run it in place:        node ${bundleName}/dist/bin.js analyze path/to/project
Or install it globally: npm install --global ./${bundleName}

Documentation: https://${owner.toLowerCase()}.github.io/${repoName}/
Source code:   ${repoUrl}
`,
);
run("tar", ["-czf", path.join(ASSETS, `${bundleName}.tar.gz`), bundleName], TMP);
run("zip", ["-qr", "-y", path.join(ASSETS, `${bundleName}.zip`), bundleName], TMP);
console.log(`bundle release/assets/${bundleName}.tar.gz, .zip`);

// 3. Documentation site -------------------------------------------------------------------------------------------
const site = path.join(root, "docs", "site");
if (existsSync(path.join(site, "index.html"))) {
  // site/app holds the same pages as data for the web UI: not part of the static site.
  run("zip", ["-qr", path.join(ASSETS, `qualis-docs-${version}.zip`), ".", "-x", "app/*"], site);
  console.log(`docs   release/assets/qualis-docs-${version}.zip`);
} else {
  console.warn("docs/site not built: the documentation archive is skipped.");
}

// 4. Checksums ----------------------------------------------------------------------------------------------------
const sums = readdirSync(ASSETS)
  .sort()
  .map((f) => `${createHash("sha256").update(readFileSync(path.join(ASSETS, f))).digest("hex")}  ${f}`);
writeFileSync(path.join(ASSETS, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
rmSync(TMP, { recursive: true, force: true });
