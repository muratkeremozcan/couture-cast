// Story 6.16 W-CONV-*, L-APPLY-THEN-SWITCH and L-READBACK-THEN-SWITCH on web: the one
// review step after a verified sign-in from the preview.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '@couture/api-client'
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
  type GuestPreviewStore,
  type SampleComfort,
} from '@couture/utils'
import type * as GuestPreviewLib from '../../../lib/guest-preview'
import { setWebGuestPreviewStoreForTests } from '../../../lib/guest-preview'
import { GuestPreviewReview } from './guest-preview-review'

const navigation = vi.hoisted(() => {
  const push = vi.fn()
  const replace = vi.fn()
  return { push, replace, router: { push, replace } }
})
vi.mock('next/navigation', () => ({ useRouter: () => navigation.router }))

const member = vi.hoisted(() => ({ id: 'member-a' as string | null, token: 'token-a' }))
vi.mock('../../../lib/web-session', () => ({
  webSessionIdentity: () => member.id,
  resolveWebSessionToken: () => Promise.resolve(member.token),
}))

const api = vi.hoisted(() => ({
  verified: vi.fn(),
  nextStep: vi.fn(),
}))
vi.mock('../../../lib/guest-preview', async (importOriginal) => ({
  ...(await importOriginal<typeof GuestPreviewLib>()),
  verifiedComfortClient: api.verified,
  resolveWebNextStep: api.nextStep,
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

let store: GuestPreviewStore
let adapter: ReturnType<typeof memoryAdapter>

async function seedProposal(withIntent = true) {
  adapter = memoryAdapter()
  store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
  setWebGuestPreviewStoreForTests(store)
  store.start()
  store.update((state) => ({
    ...state,
    comfort: PROPOSAL,
    votes: { 'sample:l:city-wool': 'like' },
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

beforeEach(async () => {
  member.id = 'member-a'
  navigation.push.mockReset()
  navigation.replace.mockReset()
  api.verified.mockReset()
  api.nextStep.mockReset().mockResolvedValue('/wardrobe/onboarding')
  await seedProposal()
})

afterEach(() => setWebGuestPreviewStoreForTests(undefined))

describe('preview carryover review (D8)', () => {
  it('goes home when there is no carryover intent', async () => {
    await seedProposal(false)
    server()
    render(<GuestPreviewReview />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(api.verified).not.toHaveBeenCalled()
  })

  it('asks for sign-in when no verified member exists (W-CONV-NO-AUTH)', async () => {
    api.verified.mockResolvedValue(null)
    render(<GuestPreviewReview />)
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/signin?from=preview')
    )
  })

  it('shows account and proposed values side by side, writing nothing yet', async () => {
    const client = server()
    render(<GuestPreviewReview />)
    expect(
      (await screen.findByTestId('guest-preview-review-account')).textContent
    ).toContain(en.values.runsColdWarm.neutral)
    expect(screen.getByTestId('guest-preview-review-proposed').textContent).toContain(
      en.values.runsColdWarm.cold
    )
    expect(client.write).not.toHaveBeenCalled()
  })

  it('keeps account preferences without a write and clears guest state', async () => {
    const client = server()
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-keep'))
    expect(screen.getByTestId('guest-preview-review-result').textContent).toBe(
      en.review.kept
    )
    expect(client.write).not.toHaveBeenCalled()
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('applies only the comfort values, confirms by read-back, then continues', async () => {
    const client = server()
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-use'))
    expect((await screen.findByTestId('guest-preview-review-result')).textContent).toBe(
      en.review.saved
    )
    expect(client.write).toHaveBeenCalledTimes(1)
    expect(client.write).toHaveBeenCalledWith(PROPOSAL)
    expect(client.read).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(adapter.value()).toBeNull())
    fireEvent.click(screen.getByTestId('guest-preview-review-continue'))
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith('/wardrobe/onboarding')
    )
    expect(api.nextStep).toHaveBeenCalledWith('token-a')
  })

  it('issues one application for a double tap', async () => {
    const client = server()
    const commit = client.write.getMockImplementation()
    let release: () => void = () => undefined
    client.write.mockImplementationOnce(
      (values) =>
        new Promise((resolve) => {
          release = () => resolve(commit?.(values) ?? Promise.resolve({ data: values }))
        })
    )
    render(<GuestPreviewReview />)
    const use = await screen.findByTestId('guest-preview-review-use')
    fireEvent.click(use)
    await waitFor(() => expect(client.write).toHaveBeenCalledTimes(1))
    fireEvent.click(use)
    expect(use.hasAttribute('disabled')).toBe(true)
    release()
    await screen.findByTestId('guest-preview-review-result')
    expect(client.write).toHaveBeenCalledTimes(1)
  })

  it('keeps the proposal for a retry when the save fails', async () => {
    const client = server()
    client.write.mockRejectedValueOnce(new Error('network'))
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-use'))
    expect((await screen.findByTestId('guest-preview-review-failed')).textContent).toBe(
      en.review.failed
    )
    expect(adapter.value()).not.toBeNull()
    fireEvent.click(screen.getByTestId('guest-preview-review-use'))
    expect((await screen.findByTestId('guest-preview-review-result')).textContent).toBe(
      en.review.saved
    )
  })

  it('discards the proposal on a server age or consent refusal', async () => {
    const client = server()
    client.write.mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 403 }))
    )
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-use'))
    expect((await screen.findByTestId('guest-preview-review-result')).textContent).toBe(
      en.review.rejected
    )
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('drops a late result and the proposal when the member changes mid-save (L-APPLY-THEN-SWITCH)', async () => {
    const client = server()
    let release: () => void = () => undefined
    client.write.mockImplementationOnce(
      (values) =>
        new Promise((resolve) => {
          release = () => resolve({ data: values })
        })
    )
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-use'))
    await waitFor(() => expect(client.write).toHaveBeenCalledTimes(1))
    member.id = 'member-b'
    act(() => {
      window.dispatchEvent(new Event('couture:session'))
    })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    release()
    await waitFor(() => expect(adapter.value()).toBeNull())
    expect(screen.queryByTestId('guest-preview-review-result')).toBeNull()
  })

  it('offers a retry when account values cannot be loaded', async () => {
    api.verified.mockRejectedValueOnce(new Error('down'))
    render(<GuestPreviewReview />)
    expect(await screen.findByText(en.review.loadFailed)).toBeInTheDocument()
    server()
    fireEvent.click(screen.getByRole('button', { name: en.chrome.retry }))
    expect(await screen.findByTestId('guest-preview-review-use')).toBeInTheDocument()
  })
})
