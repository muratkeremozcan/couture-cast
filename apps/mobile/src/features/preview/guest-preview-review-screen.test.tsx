// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 M-CONV-*, L-APPLY-THEN-SWITCH and L-G-A-B on mobile: the one review step
// after a verified sign-in from the preview.
import { act, configure, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
// CC-7.21: _bmad-output/project-knowledge/learning-path-step-by-step.md#step-78-first-look-and-account-save
import { ResponseError } from '@couture/api-client'
import type * as ApiClient from '@couture/api-client'
import type * as SavedLooks from '@/src/lib/saved-looks'
import type * as StyleProfile from '@/src/lib/style-profile'
import {
  beginGuestLookSave,
  createGuestPreviewStore,
  GUEST_PREVIEW_SAVE_INTENT,
  selectSampleOutfit,
  toSampleSelectionInput,
  GUEST_PREVIEW_CONVERSION_INTENT,
  GUEST_PREVIEW_GARMENT_INTENT,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
  type SampleComfort,
} from '@couture/utils'
import type * as GuestPreviewLib from '@/src/lib/guest-preview'
import { press } from '@/src/test-utils/press'

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  dismissTo: vi.fn(),
}))
vi.mock('expo-router', () => ({ router: navigation, useRouter: () => navigation }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/analytics/mobile-analytics', () => ({
  mobileAnalyticsClient: { capture: vi.fn(), screen: vi.fn(), getDistinctId: () => 'x' },
  resetMobileAnalyticsIdentity: vi.fn(),
}))
const api = vi.hoisted(() => ({ verified: vi.fn(), nextStep: vi.fn() }))
vi.mock('@/src/lib/guest-preview', async (importOriginal) => ({
  ...(await importOriginal<typeof GuestPreviewLib>()),
  verifiedComfortClient: api.verified,
  resolveMobileNextStep: api.nextStep,
}))

import { setMobileGuestPreviewStoreForTests } from '@/src/lib/guest-preview'
import {
  mobileApplicationUserId,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { initI18n } from '@/src/lib/i18n'
import { GuestPreviewReviewScreen } from './guest-preview-review-screen'

const lookApi = vi.hoisted(() => ({
  read: vi.fn(),
  style: vi.fn(),
  save: vi.fn(),
}))
vi.mock('@couture/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  requestStyleProfile: lookApi.read,
}))
vi.mock('@/src/lib/style-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof StyleProfile>()),
  saveMobileStyleProfileForScope: lookApi.style,
}))
vi.mock('@/src/lib/saved-looks', async (importOriginal) => ({
  ...(await importOriginal<typeof SavedLooks>()),
  createSavedLookFromMobile: lookApi.save,
}))

const en = GUEST_PREVIEW_STRINGS['en-US']
const ACCOUNT: SampleComfort = {
  runsColdWarm: 'neutral',
  windTolerance: 'medium',
  precipPreparedness: 'medium',
}
const PROPOSAL: SampleComfort = {
  runsColdWarm: 'cold',
  windTolerance: 'low',
  precipPreparedness: 'high',
}

function memoryAdapter() {
  let value: string | null = null
  return {
    value: () => value,
    read: () => Promise.resolve(value),
    write: (text: string) => {
      value = text
      return Promise.resolve()
    },
    remove: () => {
      value = null
      return Promise.resolve()
    },
  }
}

let adapter: ReturnType<typeof memoryAdapter>

async function seed(
  intent:
    | typeof GUEST_PREVIEW_CONVERSION_INTENT
    | typeof GUEST_PREVIEW_GARMENT_INTENT
    | typeof GUEST_PREVIEW_SAVE_INTENT
    | false = GUEST_PREVIEW_CONVERSION_INTENT
) {
  adapter = memoryAdapter()
  const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
  setMobileGuestPreviewStoreForTests(store)
  store.start()
  const snapshot = store.update((state) => {
    const draft = { ...state, comfort: PROPOSAL }
    if (intent === GUEST_PREVIEW_SAVE_INTENT) {
      const styled = {
        ...draft,
        preferences: { style: 'cozy', palette: 'colorful' },
      } as const
      return beginGuestLookSave(
        styled,
        selectSampleOutfit(toSampleSelectionInput(styled), SAMPLE_CATALOG)
      )
    }
    return { ...draft, ...(intent ? { conversion: { intent } } : {}) }
  })
  await store.flush()
  return snapshot?.conversion
}

function server(initial: SampleComfort = ACCOUNT) {
  let stored = initial
  const client = {
    memberId: 'member-a',
    read: vi.fn(() => Promise.resolve({ ...stored })),
    write: vi.fn((values: SampleComfort) => {
      stored = values
      return Promise.resolve({ data: values })
    }),
  }
  api.verified.mockResolvedValue(client)
  return client
}

beforeAll(async () => {
  configure({ asyncUtilTimeout: 5_000 })
  await initI18n()
})

// The app's resolver awaits session verification; this one answers a little later with
// whoever is signed in by then, so a transient null has settled before it resolves.
let restoreResolver: () => void = () => undefined

beforeEach(async () => {
  restoreResolver = setMobileAccessTokenResolver(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(mobileApplicationUserId() ? 'token' : undefined), 40)
      )
  )
  setMobileApplicationUserId('member-a')
  api.nextStep.mockResolvedValue('/wardrobe-onboarding')
  await seed()
})

afterEach(() => {
  restoreResolver()
  setMobileGuestPreviewStoreForTests(undefined)
  setMobileApplicationUserId(null)
})

describe('mobile carryover review (D8)', () => {
  it('goes Home without a carryover intent', async () => {
    await seed(false)
    server()
    await render(<GuestPreviewReviewScreen />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(api.verified).not.toHaveBeenCalled()
  })

  it('asks for sign-in without a verified member (M-CONV-NO-AUTH)', async () => {
    api.verified.mockResolvedValue(null)
    await render(<GuestPreviewReviewScreen />)
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/signin?from=preview')
    )
  })

  it('keeps account preferences with no write', async () => {
    const client = server()
    await render(<GuestPreviewReviewScreen />)
    expect(
      (await screen.findByTestId('guest-preview-review-account')).textContent
    ).toContain(en.values.runsColdWarm.neutral)
    expect(screen.getByTestId('guest-preview-review-proposed').textContent).toContain(
      en.values.runsColdWarm.cold
    )
    press(screen.getByTestId('guest-preview-review-keep'))
    expect((await screen.findByTestId('guest-preview-review-result')).textContent).toBe(
      en.review.kept
    )
    expect(client.write).not.toHaveBeenCalled()
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('applies only the comfort values after a read-back and continues to default setup', async () => {
    const client = server()
    await render(<GuestPreviewReviewScreen />)
    press(await screen.findByTestId('guest-preview-review-use'))
    expect((await screen.findByTestId('guest-preview-review-result')).textContent).toBe(
      en.review.saved
    )
    expect(client.write).toHaveBeenCalledExactlyOnceWith(PROPOSAL)
    expect(client.read).toHaveBeenCalledTimes(3)
    press(screen.getByTestId('guest-preview-review-continue'))
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/wardrobe-onboarding')
    )
    expect(api.nextStep).toHaveBeenCalledExactlyOnceWith()
  })

  it('preserves explicit garment intent after completing the comfort review', async () => {
    await seed(GUEST_PREVIEW_GARMENT_INTENT)
    server()
    api.nextStep.mockResolvedValue('/wardrobe?entry=add')
    await render(<GuestPreviewReviewScreen />)
    press(await screen.findByTestId('guest-preview-review-keep'))
    await waitFor(() => expect(adapter.value()).toBeNull())
    press(screen.getByTestId('guest-preview-review-continue'))
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/wardrobe?entry=add')
    )
    expect(api.nextStep).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('keeps the proposal for a retry when the save fails', async () => {
    const client = server()
    client.write.mockRejectedValueOnce(new Error('network'))
    await render(<GuestPreviewReviewScreen />)
    press(await screen.findByTestId('guest-preview-review-use'))
    expect((await screen.findByTestId('guest-preview-review-failed')).textContent).toBe(
      en.review.failed
    )
    expect(adapter.value()).not.toBeNull()
    await waitFor(() =>
      expect(
        screen.getByTestId('guest-preview-review-use').getAttribute('aria-disabled')
      ).not.toBe('true')
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    press(screen.getByTestId('guest-preview-review-use'))
    expect((await screen.findByTestId('guest-preview-review-result')).textContent).toBe(
      en.review.saved
    )
  })

  it('discards the proposal on a server age or consent refusal', async () => {
    const client = server()
    client.write.mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 }))
    )
    await render(<GuestPreviewReviewScreen />)
    press(await screen.findByTestId('guest-preview-review-use'))
    expect((await screen.findByTestId('guest-preview-review-result')).textContent).toBe(
      en.review.rejected
    )
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('drops the proposal and a late result when the member changes (L-APPLY-THEN-SWITCH)', async () => {
    const client = server()
    let release: () => void = () => undefined
    const commit = client.write.getMockImplementation()
    client.write.mockImplementationOnce(
      (values) =>
        new Promise((resolve) => {
          release = () => resolve(commit?.(values) ?? Promise.resolve({ data: values }))
        })
    )
    await render(<GuestPreviewReviewScreen />)
    press(await screen.findByTestId('guest-preview-review-use'))
    await waitFor(() => expect(client.write).toHaveBeenCalledOnce())
    act(() => setMobileApplicationUserId('member-b'))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    release()
    await waitFor(() => expect(adapter.value()).toBeNull())
    expect(screen.queryByTestId('guest-preview-review-result')).toBeNull()
  })

  it('never shows account values read for a member who has since changed (L-G-A-B)', async () => {
    const client = server()
    client.read.mockImplementationOnce(() => {
      setMobileApplicationUserId('member-b')
      return Promise.resolve(ACCOUNT)
    })
    await render(<GuestPreviewReviewScreen />)
    await waitFor(() => expect(client.read).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByTestId('guest-preview-review-account')).toBeNull()
  })

  // Session re-verification sets the member to null and back on an auth event; only a
  // settled different member or a settled sign-out discards the proposal.
  it('reaches the review when the member flips to null and back during the read', async () => {
    const client = server()
    client.read.mockImplementationOnce(() => {
      setMobileApplicationUserId(null)
      setTimeout(() => setMobileApplicationUserId('member-a'), 10)
      return Promise.resolve(ACCOUNT)
    })
    await render(<GuestPreviewReviewScreen />)
    expect(await screen.findByTestId('guest-preview-review-use')).toBeTruthy()
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(adapter.value()).not.toBeNull()
  })

  it('saves when the member flips to null and back during the save', async () => {
    const client = server()
    const commit = client.write.getMockImplementation()
    client.write.mockImplementationOnce((values) => {
      setMobileApplicationUserId(null)
      setTimeout(() => setMobileApplicationUserId('member-a'), 10)
      return commit?.(values) ?? Promise.resolve({ data: values })
    })
    await render(<GuestPreviewReviewScreen />)
    press(await screen.findByTestId('guest-preview-review-use'))
    // The same member settles, so the carryover runs again; it reads first and finds the
    // proposal saved, so the account is written once.
    expect(await screen.findByTestId('guest-preview-review-result')).toBeTruthy()
    expect(client.write).toHaveBeenCalledOnce()
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('discards the proposal when the read settles on a signed-out session', async () => {
    const client = server()
    client.read.mockImplementationOnce(() => {
      setMobileApplicationUserId(null)
      return Promise.resolve(ACCOUNT)
    })
    await render(<GuestPreviewReviewScreen />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    await waitFor(() => expect(adapter.value()).toBeNull())
    expect(screen.queryByTestId('guest-preview-review-account')).toBeNull()
  })

  it('offers a retry when account values cannot be loaded', async () => {
    api.verified.mockRejectedValueOnce(new Error('down'))
    await render(<GuestPreviewReviewScreen />)
    expect(await screen.findByText(en.review.loadFailed)).toBeTruthy()
    server()
    press(screen.getByTestId('guest-preview-review-retry'))
    expect(await screen.findByTestId('guest-preview-review-use')).toBeTruthy()
  })
})

describe('CC-7.21 first-run look review', () => {
  beforeEach(() => {
    lookApi.read.mockReset().mockResolvedValue(null)
    lookApi.style.mockReset().mockResolvedValue(undefined)
    lookApi.save.mockReset().mockResolvedValue({ id: 'look-saved' })
  })

  it.each(['use', 'keep'] as const)(
    'stores the exact look after the visitor chooses %s',
    async (choice) => {
      const conversion = await seed(GUEST_PREVIEW_SAVE_INTENT)
      if (conversion?.intent !== GUEST_PREVIEW_SAVE_INTENT)
        throw new Error('Missing review')
      const client = server()
      await render(<GuestPreviewReviewScreen />)
      const proposed = await screen.findByTestId('guest-preview-review-proposed')
      expect(proposed).toHaveTextContent('Cozy')
      expect(proposed).toHaveTextContent('Colorful')
      expect(lookApi.save).not.toHaveBeenCalled()
      press(screen.getByTestId(`guest-preview-review-${choice}`))
      await waitFor(() =>
        expect(navigation.dismissTo).toHaveBeenCalledWith({
          pathname: '/looks',
          params: { segment: 'saved', filter: 'all' },
        })
      )
      expect(lookApi.save).toHaveBeenCalledExactlyOnceWith(conversion.look, {
        accessToken: 'token',
        idempotencyKey: conversion.key,
      })
      if (choice === 'use') {
        expect(client.write).toHaveBeenCalledWith(PROPOSAL)
        expect(lookApi.style.mock.calls[0]?.[1]).toEqual({
          mood: 'cozy',
          palette: 'colorful',
        })
      } else {
        expect(client.write).not.toHaveBeenCalled()
        expect(lookApi.style).not.toHaveBeenCalled()
      }
      await waitFor(() => expect(adapter.value()).toBeNull())
    }
  )

  it('cancels review without saving either the look or preferences', async () => {
    await seed(GUEST_PREVIEW_SAVE_INTENT)
    const client = server()
    await render(<GuestPreviewReviewScreen />)
    press(await screen.findByTestId('guest-preview-review-cancel'))
    await waitFor(() => expect(navigation.dismissTo).toHaveBeenCalledWith('/'))
    expect(client.write).not.toHaveBeenCalled()
    expect(lookApi.save).not.toHaveBeenCalled()
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('discards a late save result after the verified identity changes', async () => {
    await seed(GUEST_PREVIEW_SAVE_INTENT)
    server()
    let finish!: (result: { id: string }) => void
    lookApi.save.mockReturnValueOnce(
      new Promise<{ id: string }>((resolve) => {
        finish = resolve
      })
    )
    await render(<GuestPreviewReviewScreen />)
    press(await screen.findByTestId('guest-preview-review-keep'))
    await waitFor(() => expect(lookApi.save).toHaveBeenCalledOnce())
    await act(async () => {
      setMobileApplicationUserId('member-b')
      finish({ id: 'first-member-look' })
      await Promise.resolve()
    })
    await waitFor(() => expect(navigation.dismissTo).toHaveBeenCalledWith('/'))
    expect(screen.queryByTestId('guest-preview-review-proposed')).toBeNull()
    expect(screen.queryByTestId('guest-preview-review-failed')).toBeNull()
  })
})
