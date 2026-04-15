import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@shared': path.join(__dirname, 'src/shared'),
    },
  },
});
