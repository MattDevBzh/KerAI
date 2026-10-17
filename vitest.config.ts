import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    // Git and archive fixtures perform substantial disk I/O; avoid saturating the host.
    maxWorkers: 4,
  },
});
