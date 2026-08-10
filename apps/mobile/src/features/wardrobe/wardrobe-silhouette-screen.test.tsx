import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  requestMediaLibraryPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { PNG: 'png' },
}))

vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    bytes() {
      return Promise.resolve(new Uint8Array())
    }
  },
  Paths: { cache: 'file:///cache/' },
}))

vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => 'idem-key-1'),
}))

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { WardrobeSilhouetteScreen } from './wardrobe-silhouette-screen'

/**
 * Base64url-shaped JWT payload, built at runtime (not a literal) so it
 * doesn't look like a credential to secret scanners -- a hardcoded
 * JWT-shaped string here previously tripped gitleaks' generic-api-key rule
 * in CI for the near-identical literal in sibling test files.
 */
function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const defaultProfile = {
  mode: 'default_mannequin' as const,
  heightSlider: 50,
  buildSlider: 50,
  myForm: null,
  revision: 1,
  updatedAt: '2026-08-09T00:00:00.000Z',
}

describe('WardrobeSilhouetteScreen', () => {
  // Declared once and restored in `afterEach` (not inline at the end of each
  // test body) so a failing assertion mid-test still releases the resolver
  // instead of leaking it into whichever test runs next -- the `restore()`
  // call this replaces sat after the only `await waitFor`/`expect` in each
  // test, so it would never have run had that assertion thrown.
  let restoreAccessTokenResolver: () => void
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    restoreAccessTokenResolver()
    vi.restoreAllMocks()
  })

  it('4.4-MOB-SIL-SCREEN-01 shows an accessible loading state, then renders the silhouette editor once a session token resolves', async () => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() =>
      fakeAccessToken('user-1')
    )
    server.use(
      http.get('*/api/v1/wardrobe/silhouette', () =>
        HttpResponse.json({ data: defaultProfile })
      )
    )

    render(<WardrobeSilhouetteScreen />)

    // Token resolution is always asynchronous (`resolveMobileAccessToken` is
    // declared `async` even though the resolver here is synchronous), so the
    // very first paint must show an accessible loading state rather than
    // nothing -- this branch had no coverage at all before this test.
    expect(screen.getByLabelText('Silhouette')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('silhouette-editor')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-SIL-SCREEN-02 prompts sign-in when no session token is available', async () => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

    render(<WardrobeSilhouetteScreen />)

    await waitFor(() => {
      expect(screen.getByText('Sign in to edit your silhouette.')).toBeInTheDocument()
    })
  })
})
