// Serves the generated documentation (docs/site) on http://localhost:<port>.
// Usage: node docs/build/serve.mjs [port]   (default 4321, or the PORT variable)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../site");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4321);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

if (!existsSync(path.join(SITE, "index.html"))) {
  console.error("The documentation has not been built yet. Run: pnpm docs:build");
  process.exit(1);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = path.join(SITE, decodeURIComponent(url.pathname));
  // Stay inside the site folder.
  if (!file.startsWith(SITE)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = path.join(file, "index.html");
    statSync(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Qualis documentation: http://localhost:${PORT}  (Ctrl+C to stop)`);
});
