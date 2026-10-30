import { defineConfig } from 'vitest/config';

// Resolve @recipe/core to its TypeScript sources (the "source" export condition),
// like tsx does in dev, so tests never run against a stale dist/.
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
});
