// Computes the release version for the CI and, with --apply, writes it into every workspace package.json.
//
//   node scripts/release/version.mjs --channel stable            -> 0.2.0        (version of the root package.json)
//   node scripts/release/version.mjs --channel beta --build 42   -> 0.2.0-beta.42
//   node scripts/release/version.mjs --channel beta --build 42 --apply
//
// Prints the version on stdout; in GitHub Actions it also writes version, tag and prerelease to $GITHUB_OUTPUT.
import { appendFileSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    channel: { type: "string", default: "stable" },
    build: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const base = readJson(path.join(root, "package.json")).version;
if (!/^\d+\.\d+\.\d+$/.test(base)) {
  throw new Error(`package.json: version "${base}" must be MAJOR.MINOR.PATCH (the beta suffix is added by the pipeline).`);
}

let version;
if (values.channel === "stable") version = base;
else if (values.channel === "beta") {
  if (!/^\d+$/.test(values.build ?? "")) throw new Error("--build <number> is required for the beta channel.");
  version = `${base}-beta.${values.build}`;
} else throw new Error(`Unknown channel "${values.channel}" (stable or beta).`);

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
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\nprerelease=${values.channel === "beta"}\n`);
}
