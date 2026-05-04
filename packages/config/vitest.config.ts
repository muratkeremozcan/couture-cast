import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
})
