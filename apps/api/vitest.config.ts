import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@couture/utils': resolve(__dirname, '../../packages/utils/src/index.ts'),
      '@couture/config': resolve(__dirname, '../../packages/config/src/index.ts'),
      '@couture/api-client': resolve(__dirname, '../../packages/api-client/src/index.ts'),
    },
  },
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
      // Ratchet: set just under the measured value so a real regression
      // fails the run. Raise these as coverage improves; never lower them
      // to make a red build green.
      thresholds: { statements: 94, branches: 88, functions: 95, lines: 94 },
      include: ['src/**/*.ts'],
      exclude: [
        // Process entrypoints. These construct and boot the Nest application
        // and the BullMQ worker processes; the Playwright and k6 suites start
        // them for real, which is the only level that proves they work.
        'src/main.ts',
        'src/workers/bootstrap.ts',
        'src/workers/wardrobe.bootstrap.ts',
        // NestJS DI metadata only — decorator arrays with no branches. Every
        // Test.createTestingModule spec resolves these providers already.
        'src/**/*.module.ts',
        // In-repo test scaffolding, not product code.
        'src/testing/**',
        'src/test-setup.ts',
      ],
    },
  },
})
