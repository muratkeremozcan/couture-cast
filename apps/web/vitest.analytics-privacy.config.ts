import { defineConfig } from 'vitest/config'

/**
 * The real-browser analytics transport check: next dev, Chromium through the installed
 * playwright library, and a local receiver in place of PostHog. It needs no database.
 * Run with `npm run test:analytics-privacy --workspace @couture/web`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test-browser/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
