import { defineConfig, mergeConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

import baseConfig from './vitest.config'

/**
 * Base for the single-file browser lanes (vitest.share-card-browser.config.ts), which add the
 * source conversion their one spec needs. It is not a suite runner: the whole web suite run
 * here fails 24 of 93 files (specs that mock modules or touch Node-only APIs), so the
 * generic `vitest:browser:run` script was removed. The Node run (`npm test`) is the suite.
 */
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
