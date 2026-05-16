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
    include: ['pact/http/provider/**/*.pacttest.ts'],
    globals: true,
    testTimeout: 60000,
    hookTimeout: 30000,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    env: {
      DISABLE_WEBSOCKETS: 'true',
    },
  },
})
