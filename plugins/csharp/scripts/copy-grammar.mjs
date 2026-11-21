// Copies the C# grammar (WebAssembly, MIT) into grammar/ so the published package
// does not depend on tree-sitter-c-sharp, whose native install script is not needed.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const wasm = require.resolve("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm");
const target = path.join(root, "grammar");
mkdirSync(target, { recursive: true });
copyFileSync(wasm, path.join(target, "tree-sitter-c_sharp.wasm"));
copyFileSync(path.join(path.dirname(wasm), "LICENSE"), path.join(target, "LICENSE"));
