# Development image for the API server and the web UI (see compose.yaml).
# Only dependencies live in the image; the source is bind-mounted, so changes reload live.
FROM node:22-bookworm-slim

# Pango (used by sharp for slide text) needs fontconfig and at least one font for "sans bold".
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.16.0

WORKDIR /app

# Linux builds of the native modules (sharp, better-sqlite3). compose.yaml keeps these
# node_modules folders in volumes, so the host's macOS node_modules never shadow them.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
