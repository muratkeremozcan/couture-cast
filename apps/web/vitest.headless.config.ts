import { defineConfig, mergeConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

import baseConfig from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [
          {
            browser: 'chromium',
            name: 'chromium-headless',
          },
        ],
        headless: true,
      },
    },
  })
)
