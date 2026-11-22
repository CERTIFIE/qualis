---
title: Install Qualis UI
description: Run Qualis UI from its container image or from a checkout of the repository, and the settings it reads.
---
Qualis UI is a web application that shows the results of the `qualis` command. It is optional: the CLI works without it. Once it runs, [connect your repositories](web-ui.html).

## With Docker

Every release publishes Qualis UI as a container image, `{{ui-image}}` (tag `latest` for official releases, `beta` for beta builds, or the exact version `{{version}}`). Mount the folder that contains your repositories under `/workspace`, and keep the UI's own data in a volume:

```bash
docker run -d --name qualis-ui -p 3000:3000 \
  -v ~/projects:/workspace:ro \
  -v qualis-data:/data \
  {{ui-image}}:latest
```

Open http://localhost:3000. Read-only access to `/workspace` is enough: the UI never writes into your repositories. The container runs as a non-root user and answers health checks on `/api/health`.

To update it, pull the new image and start the container again: projects and settings stay in the `qualis-data` volume.

```bash
docker pull {{ui-image}}:latest
docker rm -f qualis-ui
# then the same docker run as above
```

## From the source code

From a [checkout of the repository](contributing.html#build-from-source):

```bash
pnpm install
pnpm ui
```

It serves http://localhost:3000, keeps its data in `.qualis-ui/` of the checkout and lets Import project browse your home folder. `pnpm ui:dev` runs the Next.js development server instead.

To build the image yourself, from the repository root (the image copies the documentation pages, so build them first):

```bash
pnpm docs:build
docker build -f apps/ui/Dockerfile -t qualis-ui .
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `QUALIS_DATA_DIR` | `/data` in Docker, `.qualis-ui/` with `pnpm ui` | Registered projects and solutions (`projects.json`) and uploaded analyses (`uploads/<project>/`). |
| `QUALIS_BROWSE_ROOT` | `/workspace` in Docker, your home folder with `pnpm ui` | The only part of the disk the folder browser can see; symbolic links and `..` cannot leave it. |
| `QUALIS_MAX_UPLOAD_MB` | `50` | Largest report.json Read analysis accepts. |
| `QUALIS_SCAN_INTERVAL_MS` | `2000` | Minimum time between two reads of the project folders. |
| `QUALIS_DOCS_DIR` | `/app/docs` in Docker, `docs/site/app` of the repository with `pnpm ui` | The documentation pages shown under **Docs**. |
| `PORT` | `3000` | HTTP port. |

Next: [Use Qualis UI](web-ui.html).
