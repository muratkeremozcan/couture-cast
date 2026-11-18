import { describe, expect, it } from 'vitest'

import {
  allowsTestOnlySecrets,
  appliesRevenueCatTestStore,
  publicApiUrl,
} from './runtime-environment'

describe('allowsTestOnlySecrets', () => {
  it.each([
    [{ NODE_ENV: 'test' }, true],
    [{ TEST_ENV: 'local' }, true],
    [{ TEST_ENV: ' LOCAL ' }, true],
    [{ NODE_ENV: 'production', TEST_ENV: 'preview' }, false],
    [{ NODE_ENV: 'production', VERCEL_ENV: 'preview' }, false],
    [{ NODE_ENV: 'production' }, false],
    [{}, false],
  ])('returns %s for %o', (env, expected) => {
    expect(allowsTestOnlySecrets(env)).toBe(expected)
  })
})

// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
describe('appliesRevenueCatTestStore (story 6.15 D15)', () => {
  it.each([
    [{ TEST_ENV: 'local' }, true],
    [{ TEST_ENV: 'preview' }, true],
    [{ TEST_ENV: ' Preview ' }, true],
    [{ NODE_ENV: 'production', TEST_ENV: 'preview' }, true],
    [{}, false],
    [{ TEST_ENV: '' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{ TEST_ENV: 'staging' }, false],
    [{ TEST_ENV: 'production' }, false],
    [{ TEST_ENV: 'previewer' }, false],
    [{ NODE_ENV: 'production', VERCEL_ENV: 'preview' }, false],
  ])('returns %s for %o', (env, expected) => {
    expect(appliesRevenueCatTestStore(env)).toBe(expected)
  })
})

// Tester report 2026-11-17: production named http://localhost:3001 in every upload URL.
describe('publicApiUrl', () => {
  it.each([
    [{ PUBLIC_API_URL: 'https://api.example.test/' }, 'https://api.example.test'],
    [
      {
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'couture-cast-api.vercel.app',
        VERCEL_URL: 'couture-cast-abc123.vercel.app',
      },
      'https://couture-cast-api.vercel.app',
    ],
    [
      {
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        VERCEL_BRANCH_URL: 'couture-cast-api-git-fix.vercel.app',
        VERCEL_URL: 'couture-cast-abc123.vercel.app',
      },
      'https://couture-cast-api-git-fix.vercel.app',
    ],
    [
      {
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'couture-cast-abc123.vercel.app',
      },
      'https://couture-cast-abc123.vercel.app',
    ],
    [{ NODE_ENV: 'development' }, 'http://localhost:3001'],
    [{ NODE_ENV: 'test' }, 'http://localhost:3001'],
    [{}, 'http://localhost:3001'],
  ])('names the public base for %o', (env, expected) => {
    expect(publicApiUrl(env)).toBe(expected)
  })

  it('refuses to name localhost in production off Vercel', () => {
    expect(() => publicApiUrl({ NODE_ENV: 'production' })).toThrow(/PUBLIC_API_URL/)
  })
})
