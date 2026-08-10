import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Ratchet: set just under the measured value so a real regression
      // fails the run. Raise these as coverage improves; never lower them
      // to make a red build green.
      // Capped by unreachable code, not by missing tests: every flag in
      // FEATURE_FLAG_DEFINITIONS is kind 'boolean', so the string/number/json
      // arms of coerceFeatureFlagValue and both JSON type guards cannot be
      // reached through any exported entry point. That dead region holds all
      // 15 uncovered statements and 28 of the 29 uncovered branches. Raising
      // this needs a production decision, not another test.
      thresholds: { statements: 60, branches: 34, functions: 71, lines: 61 },
      include: ['src/**/*.ts'],
    },
  },
})
