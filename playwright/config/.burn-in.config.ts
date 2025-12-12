import type { BurnInConfig } from '@seontechnologies/playwright-utils/burn-in'

const config: BurnInConfig = {
  skipBurnInPatterns: [
    '**/config/**',
    '**/configuration/**',
    '**/playwright.config.ts',
    '**/*featureFlags*',
    '**/*constants*',
    '**/*config*',
    '**/*types*',
    '**/*interfaces*',
    '**/package.json',
    '**/tsconfig.json',
    '**/*.md',
  ],
  testPatterns: ['**/*.spec.ts', '**/*.test.ts', '**/*.e2e.ts'],
  burnIn: {
    repeatEach: 3,
    retries: process.env.CI ? 0 : 1,
  },
  burnInTestPercentage: process.env.CI ? 0.5 : 1,
  debug: false,
}

export default config
