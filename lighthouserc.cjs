const { chromium } = require('@playwright/test')

process.env.CHROME_PATH ||= chromium.executablePath()

const baseUrl = process.env.LHCI_BASE_URL || 'http://127.0.0.1:3005'
const routes = ['/', '/community', '/wardrobe', '/settings']

module.exports = {
  ci: {
    collect: {
      url: routes.map((route) => new URL(route, baseUrl).href),
      numberOfRuns: 1,
      settings: {
        onlyCategories: ['accessibility'],
        chromeFlags: '--headless --no-sandbox --disable-dev-shm-usage',
      },
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 1 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: 'playwright/artifacts/lighthouse',
    },
  },
}
