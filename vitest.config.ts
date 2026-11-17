import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/shared/test/**/*.test.ts', 'apps/api/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ['default'],
  },
});
