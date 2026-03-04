import { defineConfig, mergeConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

import baseConfig from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
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
