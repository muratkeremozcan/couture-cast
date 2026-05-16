import type { V3MockServer } from '@pact-foundation/pact'
import { PactV4 } from '@pact-foundation/pact'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { createMobileApiClient } from '../../../apps/mobile/src/lib/api-client'
import {
  verifyApiHealthInteraction,
  verifyEventsPollInteraction,
  verifyInvalidCursorInteraction,
} from './api-contract-interactions'

const pact = new PactV4({
  dir: path.resolve(process.cwd(), 'pacts'),
  consumer: 'CoutureCastMobile',
  provider: 'CoutureCastApi',
  logLevel: 'warn',
})

const originalExpoBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
const originalApiBaseUrl = process.env.API_BASE_URL

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

function createMobileClientForMockServer(mockServer: V3MockServer) {
  process.env.EXPO_PUBLIC_API_BASE_URL = mockServer.url
  delete process.env.API_BASE_URL

  return createMobileApiClient()
}

describe('CoutureCastMobile -> CoutureCastApi HTTP contract', () => {
  afterEach(() => {
    restoreEnvironmentVariable('EXPO_PUBLIC_API_BASE_URL', originalExpoBaseUrl)
    restoreEnvironmentVariable('API_BASE_URL', originalApiBaseUrl)
  })

  it('reads API health metadata', async () => {
    await verifyApiHealthInteraction(pact, createMobileClientForMockServer)
  })

  it('polls realtime fallback events', async () => {
    await verifyEventsPollInteraction(pact, createMobileClientForMockServer)
  })

  it('returns the graceful invalid cursor payload used by fallback clients', async () => {
    await verifyInvalidCursorInteraction(pact, createMobileClientForMockServer)
  })
})
