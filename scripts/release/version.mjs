// Computes the release version for the CI and, with --apply, writes it into every workspace package.json.
//
//   node scripts/release/version.mjs --tag v0.2.0                -> 0.2.0          (stable: npm tag "latest")
//   node scripts/release/version.mjs --tag v0.2.0-beta.1         -> 0.2.0-beta.1   (prerelease: npm tag "beta")
//   node scripts/release/version.mjs                             -> version of the root package.json (not a release)
//   node scripts/release/version.mjs --tag v0.2.0 --apply
//
// Releases are made by pushing a tag vX.Y.Z (or vX.Y.Z-<prerelease>): the tag is the version, package.json does
// not need to be changed. Prints the version on stdout; in GitHub Actions it also writes version, tag, channel and
// prerelease to $GITHUB_OUTPUT.
import { appendFileSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    tag: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

let version;
if (values.tag !== undefined) {
  if (!values.tag.startsWith("v") || !SEMVER.test(values.tag.slice(1))) {
    throw new Error(`Tag "${values.tag}" is not a release tag: use vMAJOR.MINOR.PATCH, or vMAJOR.MINOR.PATCH-beta.N for a prerelease.`);
  }
  version = values.tag.slice(1);
} else {
  version = readJson(path.join(root, "package.json")).version;
  if (!SEMVER.test(version)) throw new Error(`package.json: version "${version}" is not MAJOR.MINOR.PATCH.`);
}
const prerelease = SEMVER.exec(version)[4] !== undefined;
const channel = prerelease ? "beta" : "stable";

/** Every package.json of the workspace (pnpm-workspace.yaml: packages/*, apps/*, plugins/*, docs) and the root. */
export function workspaceManifests() {
  const files = [path.join(root, "package.json"), path.join(root, "docs/package.json")];
  for (const dir of ["packages", "plugins", "apps"]) {
    for (const name of readdirSync(path.join(root, dir))) {
      const file = path.join(root, dir, name, "package.json");
      if (existsSync(file)) files.push(file);
    }
  }
  return files;
}

if (values.apply) {
  for (const file of workspaceManifests()) {
    const json = readJson(file);
    json.version = version;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }
  console.error(`Version ${version} written to ${workspaceManifests().length} package.json files.`);
}

console.log(version);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\nchannel=${channel}\nprerelease=${prerelease}\n`);
}
