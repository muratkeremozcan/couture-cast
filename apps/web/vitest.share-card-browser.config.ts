import path from 'node:path'
import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config'
import baseConfig from './vitest.headless.config'

const config = mergeConfig(
  baseConfig,
  defineConfig({
    // Next's browser modules expect env substitution. Never expose host env values.
    define: { 'process.env': {} },
    resolve: {
      alias: [
        {
          find: 'node:buffer',
          replacement: path.resolve(__dirname, 'src/test-utils/browser-blob.ts'),
        },
      ],
    },
    // Workspace packages ship CommonJS; Vite must convert them for the browser.
    optimizeDeps: {
      include: [
        '@couture/api-client',
        '@couture/api-client/contracts/http',
        '@couture/api-client/testing/share-card-fixture',
        '@couture/utils',
        '@couture/config',
      ],
    },
  })
) as ViteUserConfig
config.test = {
  ...config.test,
  include: ['src/app/components/community-share-card-host.test.tsx'],
}
export default config
