import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts', 'integration/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
})
