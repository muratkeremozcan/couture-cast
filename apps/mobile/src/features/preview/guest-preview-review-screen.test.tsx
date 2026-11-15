// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 M-CONV-*, L-APPLY-THEN-SWITCH and L-G-A-B on mobile: the one review step
// after a verified sign-in from the preview.
import { act, configure, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '@couture/api-client'
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
  type SampleComfort,
} from '@couture/utils'
import type * as GuestPreviewLib from '@/src/lib/guest-preview'
import { press } from '@/src/test-utils/press'

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
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
import { setMobileApplicationUserId } from '@/src/lib/mobile-auth'
import { initI18n } from '@/src/lib/i18n'
import { GuestPreviewReviewScreen } from './guest-preview-review-screen'

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

async function seed(withIntent = true) {
  adapter = memoryAdapter()
  const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
  setMobileGuestPreviewStoreForTests(store)
  store.start()
  store.update((state) => ({
    ...state,
    comfort: PROPOSAL,
    ...(withIntent ? { conversion: { intent: 'guest-preview-carryover' as const } } : {}),
  }))
  await store.flush()
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

beforeEach(async () => {
  setMobileApplicationUserId('member-a')
  api.nextStep.mockResolvedValue('/wardrobe-onboarding')
  await seed()
})

afterEach(() => {
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

  it('applies only the comfort values after a read-back, then continues', async () => {
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

  it('offers a retry when account values cannot be loaded', async () => {
    api.verified.mockRejectedValueOnce(new Error('down'))
    await render(<GuestPreviewReviewScreen />)
    expect(await screen.findByText(en.review.loadFailed)).toBeTruthy()
    server()
    press(screen.getByTestId('guest-preview-review-retry'))
    expect(await screen.findByTestId('guest-preview-review-use')).toBeTruthy()
  })
})
