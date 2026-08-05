import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts', 'integration/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...(process.env.RUN_GARMENT_TAGGING_SMOKE === 'true'
        ? []
        : ['**/garment-tagging.smoke.spec.ts']),
    ],
    setupFiles: [resolve(__dirname, 'src/test-setup.ts')],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
})
