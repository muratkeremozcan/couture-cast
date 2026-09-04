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
      '@couture/utils': path.resolve(projectRoot, 'packages/utils/src/index.ts'),
      '@couture/config': path.resolve(projectRoot, 'packages/config/src/index.ts'),
      '@couture/testing': path.resolve(projectRoot, 'packages/testing/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['pact/http/provider/**/*.pacttest.ts'],
    globals: true,
    // The single `it()` in api-provider.pacttest.ts verifies every interaction
    // from both pact files sequentially against one real (in-memory) Nest app
    // (fileParallelism/singleFork below keep it that way on purpose, since the
    // provider doubles' scenario state is process-global). That per-interaction
    // cost is real, not incidental, and grows every story: this budget was set
    // once in Story 4.1/4.2 at 60s and never revisited despite the interaction
    // count climbing every story since (175 total as of Story 5.5). A clean run
    // already used 48s of that 60s locally; bumped with real headroom rather
    // than raised just enough to clear the last observed run.
    testTimeout: 180000,
    hookTimeout: 60000,
    fileParallelism: false,
    pool: 'forks',
    // @ts-expect-error -- Vitest 4 InlineConfig types omit poolOptions singleFork
    poolOptions: { forks: { singleFork: true } },
    env: {
      DISABLE_WEBSOCKETS: 'true',
    },
  },
})
