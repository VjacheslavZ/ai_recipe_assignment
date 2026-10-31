# One image: API server + job worker + built web UI on port 3001.
# Runs TypeScript from source with tsx (same as `pnpm dev:server`), so no server build step.
FROM node:22-bookworm-slim

# Pango (used by sharp for slide text) needs fontconfig and at least one font for "sans bold".
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.16.0

WORKDIR /app

# Install dependencies first so this layer is cached until a manifest changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY brief.example.yaml ./
RUN pnpm --filter @recipe/web build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATABASE_PATH=/app/data/recipe.db \
    RUNS_DIR=/app/runs \
    BRAND_KIT_DIR=/app/brand_kit
RUN mkdir -p data runs brand_kit
VOLUME ["/app/data", "/app/runs"]
EXPOSE 3001

CMD ["pnpm", "exec", "tsx", "--conditions=source", "packages/server/src/index.ts"]
