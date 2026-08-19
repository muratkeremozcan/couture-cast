import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * The database `integration/**` probes for, resolved HERE rather than left to each
 * suite's own `process.env` lookup.
 *
 * Those suites skip themselves when their schema probe fails, which is deliberate: a
 * developer with no database still gets the unit tier. What is not deliberate is
 * probing the WRONG database. `packages/db/.env` exists so the Prisma CLI has a
 * `DATABASE_URL`, and importing `@prisma/client` loads it as a side effect, silently
 * overwriting `process.env.DATABASE_URL` inside the worker with whatever database that
 * file names. The suites' `INTEGRATION_TEST_DATABASE_URL ?? DATABASE_URL ?? <local
 * Supabase>` chain then resolves to it, the probe finds no `PremiumEntitlement` table,
 * and sixty-one tests announce themselves skipped for a reason that reads like "no
 * database" when a fully migrated one is running on the machine.
 *
 * The cost is a silent coverage hole, not a red run: measured on 2026-08-18 that
 * skipping put the ratchet at 93.28/87.12/93.62/93.27 against 94/88/95/94, and the
 * failure names coverage rather than the database. `packages/db/vitest.config.ts`
 * carries the same guard for the same reason, and the Maestro runner hit the identical
 * trap; see `_bmad-output/test-artifacts/maestro-suite-repair-handoff.md` and its
 * standing rule: never resolve a test database URL through that variable.
 *
 * This config is evaluated before any test module, and therefore before that dotenv
 * load can run, so the value below is the one the shell or CI actually chose. Pinning
 * it into `test.env` also makes it win afterwards, because dotenv never overwrites a
 * variable that is already set. A machine with no database still skips, exactly as
 * before, because the probe against the local Supabase default simply fails.
 */
const integrationDatabaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

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
    // Both names are pinned so the lookup chain the integration suites share cannot
    // resolve to two different databases depending on which of them a suite reads.
    env: {
      DATABASE_URL: integrationDatabaseUrl,
      INTEGRATION_TEST_DATABASE_URL: integrationDatabaseUrl,
    },
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
