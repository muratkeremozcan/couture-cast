// Learning path Step 81: Photo AI consent and processor approval.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-81-photo-ai-consent-and-processor-approval
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import type * as ApiClient from '@couture/api-client'
import i18n, { initI18n } from '@/src/lib/i18n'
import type * as MobileApiClient from '@/src/lib/api-client'
import type * as MobileUser from '@/src/lib/user'
import {
  mobileApplicationUserId,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import AccountSettingsScreen from '../../../app/settings-account'

type Consent = Awaited<ReturnType<typeof ApiClient.requestPhotoAiConsent>>
type Grant = Consent['grants'][number]
const OWNER = 'fixture-photo-owner'
const OTHER = 'fixture-photo-other'
const OLD_GRANT: Grant = {
  id: 'cb6499c1-b8f1-4199-8891-ee5161829c21',
  feature: 'garment-tags',
  inputClass: 'garment-photo',
  provider: 'fixture-processor',
  policyVersion: 'fixture-v1',
  expiresAt: '2090-12-01T00:00:00.000Z',
}
const OTHER_GRANT: Grant = {
  ...OLD_GRANT,
  id: 'cb6499c1-b8f1-4199-8891-ee5161829c22',
  feature: 'garment-cutout',
}

const { requestConsent, createClient } = vi.hoisted(() => ({
  requestConsent: vi.fn<typeof ApiClient.requestPhotoAiConsent>(),
  createClient: vi.fn((options: { accessToken: string }) => options),
}))
vi.mock('@couture/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  requestPhotoAiConsent: requestConsent,
}))
vi.mock('@/src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof MobileApiClient>()),
  createMobileApiClient: createClient,
}))
vi.mock('@/src/lib/user', async (importOriginal) => ({
  ...(await importOriginal<typeof MobileUser>()),
  getUserProfileFromMobile: () =>
    Promise.resolve({
      user: { displayName: 'Test member', email: 'member@example.test' },
    }),
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', async () => ({
  useFocusEffect: (await import('../../test-utils/focus-effect.js')).useFocusEffect,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function consent(...grants: Grant[]): Consent {
  return { externalProcessingEnabled: false, grants }
}

function revokeButton(grant: Grant) {
  return `photo-ai-revoke-${grant.id}`
}

describe('CC-7.24 native photo AI consent', () => {
  let restoreToken: () => void

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    requestConsent.mockReset()
    createClient.mockClear()
    restoreToken = setMobileAccessTokenResolver(
      () => `verified-${mobileApplicationUserId()}`
    )
    setMobileApplicationUserId(OWNER)
  })

  afterEach(() => {
    setMobileApplicationUserId(null)
    restoreToken()
  })

  it('drops a previous member’s late read after an account switch', async () => {
    const oldRead = deferred<Consent>()
    requestConsent
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(consent(OTHER_GRANT))
    render(<AccountSettingsScreen />)
    await waitFor(() => expect(requestConsent).toHaveBeenCalledTimes(1))

    act(() => setMobileApplicationUserId(OTHER))
    await screen.findByTestId(revokeButton(OTHER_GRANT))
    await act(async () => {
      oldRead.resolve(consent(OLD_GRANT))
      await oldRead.promise
    })

    expect(requestConsent.mock.calls[0]?.[1].aborted).toBe(true)
    expect(createClient.mock.calls.map(([options]) => options.accessToken)).toEqual([
      `verified-${OWNER}`,
      `verified-${OTHER}`,
    ])
    expect(screen.getByTestId(revokeButton(OTHER_GRANT))).toBeEnabled()
    expect(screen.queryByTestId(revokeButton(OLD_GRANT))).toBeNull()
  })

  it('sends revocation with the captured bearer and preserves the new member’s grants', async () => {
    const oldRevocation = deferred<Consent>()
    requestConsent
      .mockResolvedValueOnce(consent(OLD_GRANT))
      .mockReturnValueOnce(oldRevocation.promise)
      .mockResolvedValueOnce(consent(OTHER_GRANT))
    render(<AccountSettingsScreen />)

    await userEvent.click(await screen.findByTestId(revokeButton(OLD_GRANT)))
    await waitFor(() => expect(requestConsent.mock.calls[1]?.[2]).toBe(OLD_GRANT.id))
    expect(createClient.mock.calls[1]?.[0].accessToken).toBe(`verified-${OWNER}`)

    act(() => setMobileApplicationUserId(OTHER))
    expect(screen.queryByTestId(revokeButton(OLD_GRANT))).toBeNull()
    await screen.findByTestId(revokeButton(OTHER_GRANT))
    await act(async () => {
      oldRevocation.resolve(consent())
      await oldRevocation.promise
    })

    expect(requestConsent.mock.calls[1]?.[1].aborted).toBe(true)
    expect(createClient.mock.calls[2]?.[0].accessToken).toBe(`verified-${OTHER}`)
    expect(screen.getByTestId(revokeButton(OTHER_GRANT))).toBeEnabled()
    expect(screen.getByTestId('photo-ai-consent-status')).toHaveTextContent(
      'Photo AI is off.'
    )
  })
})
