import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

export default defineConfig({
  resolve: {
    alias: {
      '@couture/api-client/contracts/http': path.resolve(
        projectRoot,
        'packages/api-client/src/contracts/http/index.ts'
      ),
      '@couture/api-client': path.resolve(
        projectRoot,
        'packages/api-client/src/index.ts'
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['pact/http/consumer/**/*.pacttest.ts'],
    globals: true,
    testTimeout: 30000,
    fileParallelism: false,
    pool: 'forks',
    // @ts-expect-error -- Vitest 4 InlineConfig types omit poolOptions singleFork
    poolOptions: { forks: { singleFork: true } },
    // Bounded retry for a confirmed PactV4 FFI mock-server timing race, not a
    // masked coverage gap. `.addInteraction()...executeTest()` tears down the
    // previous interaction's mock server and stands up a fresh one for every
    // single test, hundreds of times per file; under real CPU contention (CI
    // runners, or 12 of 14 local cores saturated on purpose to reproduce it)
    // that teardown/startup pair can overlap, and whichever interaction is
    // mid-registration at that moment fails with "The following request was
    // expected but not received" even though its own request/response pair is
    // correct -- a different, unrelated interaction each time. It never
    // reproduces at rest (confirmed clean across 5+ local runs including this
    // script's own 3x determinism check), only under contention, and is
    // already the documented cause of the *other* known PactV4 FFI failure
    // mode this codebase works around (see the "one interaction per it()"
    // comments throughout pact/http/consumer/interactions/*.ts) -- this is
    // the same instability's less common, cross-test variant. A retry re-runs
    // the whole test body, which re-registers the interaction against a brand
    // new mock server rather than reusing any state from the failed attempt,
    // so it cannot mask a genuinely wrong interaction: a real contract defect
    // fails identically and deterministically on every attempt.
    retry: 1,
  },
})
