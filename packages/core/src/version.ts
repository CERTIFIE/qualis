import { readFileSync } from "node:fs";

/** Version of @qualis/core, read from its package.json. */
export const CORE_VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;
