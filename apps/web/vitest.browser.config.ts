import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

import baseConfig from './vitest.config'

const packages = (name: string) => path.resolve(__dirname, '../../packages', name, 'src')

/**
 * Interactive browser runner for debugging one spec at a time (`npm run vitest:open`). It is
 * not a suite lane: the Node run (`npm test`) is the one that gates, and a full run here
 * still fails files that mock modules or touch Node-only APIs.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    // A real browser imports workspace packages as ES modules, and their dist builds are
    // CommonJS whose named exports it cannot see, so this runner reads their source.
    resolve: {
      alias: [
        {
          find: /^@couture\/api-client\/(.+)$/,
          replacement: `${packages('api-client')}/$1`,
        },
        {
          find: '@couture/api-client',
          replacement: `${packages('api-client')}/index.ts`,
        },
        { find: '@couture/testing', replacement: `${packages('testing')}/index.ts` },
        { find: '@couture/utils', replacement: `${packages('utils')}/index.ts` },
        { find: '@couture/config', replacement: `${packages('config')}/index.ts` },
      ],
    },
    // Next inlines process.env at build time; a real browser has no process, and the specs
    // read only unset NEXT_PUBLIC_* values (relative API URLs the mock worker serves).
    define: { 'process.env': {} },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react/jsx-dev-runtime'],
    },
    test: {
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [
          {
            browser: 'chromium',
            name: 'chromium-ui',
          },
        ],
        headless: false,
      },
    },
  })
)
