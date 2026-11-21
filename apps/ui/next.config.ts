import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image; file tracing starts at the monorepo root.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Test fixtures are not part of the server.
  outputFileTracingExcludes: { "*": ["./test/**"] },
  poweredByHeader: false,
  // The dev server is often opened as 127.0.0.1; allow its HMR connection.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
