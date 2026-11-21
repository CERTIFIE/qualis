# syntax=docker/dockerfile:1
# Qualis web UI on port 3000. Two ways in:
#   Import project  reads <project>/.qualis/ of folders mounted under /workspace (read-only is enough)
#   Read analysis   stores uploaded report.json files in the /data volume, with the list of projects
# Build from the repository root, so that the workspace packages are in the context:
#   pnpm docs:build          (the documentation shown under /docs, from docs/site/app)
#   docker build -f apps/ui/Dockerfile -t qualis-ui .
#   docker run --rm -p 3000:3000 -v ~/workspace:/workspace:ro -v qualis-data:/data qualis-ui

FROM node:22-alpine AS build
ENV NEXT_TELEMETRY_DISABLED=1
# pnpm in the version pinned by packageManager in package.json.
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/schema/package.json packages/schema/
COPY apps/ui/package.json apps/ui/
# Only the UI and the workspace packages it depends on.
RUN pnpm install --frozen-lockfile --filter "@qualis/ui..."
COPY packages/schema packages/schema
COPY apps/ui apps/ui
# The UI type-checks against the compiled declarations of @qualis/schema.
RUN pnpm --filter @qualis/ui exec tsc -p ../../packages/schema \
    && pnpm --filter @qualis/ui build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    QUALIS_DATA_DIR=/data \
    QUALIS_BROWSE_ROOT=/workspace \
    QUALIS_DOCS_DIR=/app/docs
WORKDIR /app
RUN addgroup -S qualis && adduser -S -G qualis -h /app qualis \
    && mkdir -p /data /workspace && chown qualis:qualis /data /workspace
# Next.js standalone output: a minimal server with only the files it needs.
COPY --from=build --chown=qualis:qualis /repo/apps/ui/.next/standalone ./
COPY --from=build --chown=qualis:qualis /repo/apps/ui/.next/static ./apps/ui/.next/static
COPY --from=build --chown=qualis:qualis /repo/apps/ui/public ./apps/ui/public
COPY --chown=qualis:qualis docs/site/app ./docs
USER qualis
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/ui/server.js"]
