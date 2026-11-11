import type { BurnInConfig } from '@seontechnologies/playwright-utils/burn-in'

const config: BurnInConfig = {
  // A custom list replaces the library defaults, so it carries their support-directory form
  // (playwright-utils PR #278): files inside constants/, types/ and interfaces/, nested too,
  // skip, and a spec, test or e2e file there still burns in.
  skipBurnInPatterns: [
    '**/config/**',
    '**/configuration/**',
    '**/playwright.config.ts',
    '**/*featureFlags*',
    '**/*constants!(*.spec.*|*.test.*|*.e2e.*)',
    '**/constants/**/!(*.spec.*|*.test.*|*.e2e.*)',
    '**/*config*',
    '**/*types!(*.spec.*|*.test.*|*.e2e.*)',
    '**/types/**/!(*.spec.*|*.test.*|*.e2e.*)',
    '**/*interfaces!(*.spec.*|*.test.*|*.e2e.*)',
    '**/interfaces/**/!(*.spec.*|*.test.*|*.e2e.*)',
    '**/package.json',
    '**/tsconfig.json',
    '**/*.md',
  ],
  testPatterns: [
    'playwright/tests/**/*.spec.ts',
    'playwright/tests/**/*.test.ts',
    'playwright/tests/**/*.e2e.ts',
  ],
  burnIn: {
    repeatEach: 3,
    retries: process.env.CI ? 0 : 1,
  },
  burnInTestPercentage: process.env.CI ? 0.5 : 1,
  debug: false,
}

export default config
