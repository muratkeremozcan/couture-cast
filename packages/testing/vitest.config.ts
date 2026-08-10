import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Without an explicit include, only files a test imports are scored, so
      // a factory nothing imports is silently absent from the denominator
      // rather than counted as uncovered. That read 100% while five factory
      // modules had no test at all.
      include: ['src/**/*.ts'],
      // Ratchet: set just under the measured value so a real regression
      // fails the run. Raise these as coverage improves; never lower them
      // to make a red build green.
      thresholds: { statements: 80, branches: 87, functions: 78, lines: 80 },
    },
  },
})
