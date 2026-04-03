import type { Configuration } from '../src'
import { expect, test } from 'vitest'
import { DefaultApi, createApiClient } from '../src'

// Story 0.9 Task 3 step 5 owner:
// prove that the package root exports produce the wrapped generated client shape we intend to ship.
test('creates a generated DefaultApi client from the root export surface', () => {
  const client = createApiClient('https://api.couturecast.test', 'token-123')
  const configuration = (client as unknown as { configuration: Configuration })
    .configuration

  expect(client).toBeInstanceOf(DefaultApi)
  expect(configuration.basePath).toBe('https://api.couturecast.test')
  expect(typeof configuration.accessToken).toBe('function')
})
