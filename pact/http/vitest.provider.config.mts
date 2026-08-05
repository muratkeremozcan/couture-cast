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
      '@couture/utils': path.resolve(
        projectRoot,
        'packages/utils/src/index.ts'
      ),
      '@couture/config': path.resolve(
        projectRoot,
        'packages/config/src/index.ts'
      ),
      '@couture/testing': path.resolve(
        projectRoot,
        'packages/testing/src/index.ts'
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['pact/http/provider/**/*.pacttest.ts'],
    globals: true,
    testTimeout: 60000,
    hookTimeout: 30000,
    fileParallelism: false,
    pool: 'forks',
    // @ts-expect-error -- Vitest 4 InlineConfig types omit poolOptions singleFork
    poolOptions: { forks: { singleFork: true } },
    env: {
      DISABLE_WEBSOCKETS: 'true',
    },
  },
})
