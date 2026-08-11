import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['test/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'lcov'],
      // Story 5.1 Task 1 added this block so
      // `scripts/run-workspace-test-coverage.mjs` picks this workspace up at
      // all: before it, `packages/db/test/**` had no `test:coverage` script and
      // therefore never ran on a pull request, despite holding the RLS actor
      // matrix and every schema constraint assertion.
      //
      // Scope is deliberately just the seeds. The rest of this workspace is
      // Prisma schema and hand-authored SQL, which the suites exercise through a
      // live PostgreSQL connection rather than by importing TypeScript, so there
      // is no source file for a coverage tool to instrument.
      //
      // Ratchet: set just under the measured value so a real regression fails
      // the run. Never lower these to make a red build green.
      //
      // The absolute numbers look alarming and are explained by which files are
      // in scope, not by missing tests. `commerce.ts` is at 100%. Every other
      // seed module is at 0% because nothing imports it: they run only through
      // `prisma db seed`, as a subprocess, during `db:reset` and end-to-end
      // setup, which no coverage instrument observes. Raising the global number
      // means unit-testing those older seeds, which is real work this story does
      // not own.
      thresholds: { statements: 13, branches: 10, functions: 9, lines: 14 },
      include: ['prisma/seeds/**/*.ts'],
      // index.ts runs `main()` on import, so instrumenting it would execute the
      // whole seed against whatever database the coverage run happens to see.
      exclude: ['prisma/seeds/index.ts'],
    },
  },
})
