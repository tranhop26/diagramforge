import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'examples', 'scripts'],
    environment: 'node',
    // 30 s default gives a healthy safety margin for the stdio MCP
    // server smoke tests on slow CI hosts. Most stdio tests have
    // explicit `, 15_000)` overrides; the higher default catches the
    // non-stdio in-process tests and the few stdio tests that don't
    // override the timeout individually.
    testTimeout: 30_000,
    reporters: ['default'],
  },
});
