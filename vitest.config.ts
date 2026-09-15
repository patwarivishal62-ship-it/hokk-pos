import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside React Server Components; stub it for tests.
      'server-only': path.resolve(__dirname, 'tests/helpers/empty.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    // Match Next.js: automatic JSX runtime for .tsx (components + tests).
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
    testTimeout: 20000,
  },
});
