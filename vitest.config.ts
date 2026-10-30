import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each package folder is a Vitest project; packages without tests are skipped.
    projects: ['packages/*'],
    passWithNoTests: true,
  },
});
