import { describe, expect, it } from 'vitest'

import { allowsTestOnlySecrets, appliesRevenueCatTestStore } from './runtime-environment'

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
