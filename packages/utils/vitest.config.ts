import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Without an explicit include, only files a test imports are scored, so
      // an unimported module is silently absent from the denominator rather
      // than counted as uncovered.
      include: ['src/**/*.ts'],
      // Story CC-7.10 P8: the screen budget measure needs a layout engine, so node cannot run
      // it. Its proof is playwright/tests/screen-budget-rules.spec.ts, which runs every rule on
      // synthetic DOM in Chromium; screen-budget.ts (the verdict) stays under these thresholds.
      exclude: ['src/screen-budget-measure.ts'],
      // Ratchet: set just under the measured value so a real regression
      // fails the run. Raise these as coverage improves; never lower them
      // to make a red build green.
      thresholds: { statements: 99, branches: 96, functions: 100, lines: 99 },
    },
  },
})
