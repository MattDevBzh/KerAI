import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    // Cap disk-heavy fixtures without increasing Vitest's default on small CI runners.
    maxWorkers: Math.min(4, Math.max(1, availableParallelism() - 1)),
  },
});
