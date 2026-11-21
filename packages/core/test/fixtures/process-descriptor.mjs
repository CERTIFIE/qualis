// Test fixture: a module asking the host to start a plugin as a separate process.
import { fileURLToPath } from "node:url";

export default { command: process.execPath, args: [fileURLToPath(new URL("./stdio-plugin.mjs", import.meta.url))] };
