import { describe, expect, it } from 'vitest'

import { allowsTestOnlySecrets } from './runtime-environment'

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
