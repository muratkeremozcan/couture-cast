// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 W-CONV-*, L-APPLY-THEN-SWITCH and L-READBACK-THEN-SWITCH on web: the one
// review step after a verified sign-in from the preview.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// CC-7.21: _bmad-output/project-knowledge/learning-path-step-by-step.md#step-78-first-look-and-account-save
import { ResponseError } from '@couture/api-client'
import type * as ApiClient from '@couture/api-client'
import type * as SavedLooks from '../../../lib/saved-looks'
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
  type GuestPreviewStore,
  type SampleComfort,
  type StatusBarNoticeInput,
} from '@couture/utils'
import type * as GuestPreviewLib from '../../../lib/guest-preview'
import { setWebGuestPreviewStoreForTests } from '../../../lib/guest-preview'
import { SavedLookRequestError } from '../../../lib/saved-looks'
import { GuestPreviewReview } from './guest-preview-review'

const navigation = vi.hoisted(() => {
  const push = vi.fn()
  const replace = vi.fn()
  return { push, replace, router: { push, replace } }
})
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  // Story CC-7.9 D6: the shared top bar reads the path to mark the active tab.
  usePathname: () => '/preview/continue',
}))

const member = vi.hoisted(() => ({
  id: 'member-a' as string | null,
  token: 'token-a',
  revision: 0,
  scope() {
    return this.id ? `${this.id}:${this.revision}` : null
  },
}))
vi.mock('../../../lib/web-session', () => ({
  webSessionIdentity: () => member.id,
  // The app's resolver awaits session verification; this one answers a little later with
  // whoever is signed in by then, so a transient null has settled before it resolves.
  resolveWebSessionToken: () =>
    new Promise((resolve) =>
      setTimeout(() => resolve(member.id ? member.token : undefined), 30)
    ),
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

const lookApi = vi.hoisted(() => ({
  read: vi.fn(),
  style: vi.fn(),
  save: vi.fn(),
}))
const notice = vi.hoisted(() => vi.fn<(input: StatusBarNoticeInput) => void>())
vi.mock('../save-feedback', () => ({ useStatusBar: () => ({ showNotice: notice }) }))
vi.mock('@couture/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  requestStyleProfile: lookApi.read,
}))
vi.mock('../../../lib/use-web-session', () => ({
  currentWebStyleScope: () => member.scope(),
  captureWebStyleBearer: (scope: string) =>
    scope === member.scope() ? member.token : null,
  subscribeWebStyleScope: (listener: () => void) => {
    window.addEventListener('storage', listener)
    return () => window.removeEventListener('storage', listener)
  },
}))
vi.mock('../../../lib/style-profile', () => ({
  saveWebStyleProfileForScope: lookApi.style,
}))
vi.mock('../../../lib/saved-looks', async (importOriginal) => ({
  ...(await importOriginal<typeof SavedLooks>()),
  createSavedLookFromWeb: lookApi.save,
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

async function seedProposal(
  intent:
    | typeof GUEST_PREVIEW_CONVERSION_INTENT
    | typeof GUEST_PREVIEW_GARMENT_INTENT
    | typeof GUEST_PREVIEW_SAVE_INTENT
    | false = GUEST_PREVIEW_CONVERSION_INTENT
) {
  adapter = memoryAdapter()
  store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
  setWebGuestPreviewStoreForTests(store)
  store.start()
  const snapshot = store.update((state) => {
    const draft = {
      ...state,
      comfort: PROPOSAL,
      votes: { 'sample:l:city-wool': 'like' as const },
    }
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

beforeEach(async () => {
  member.id = 'member-a'
  member.revision = 0
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

  it('applies only the comfort values, confirms by read-back, and continues to default setup', async () => {
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

  it('preserves explicit garment intent after completing the comfort review', async () => {
    const user = userEvent.setup()
    await seedProposal(GUEST_PREVIEW_GARMENT_INTENT)
    server()
    api.nextStep.mockResolvedValue('/wardrobe?entry=add')
    render(<GuestPreviewReview />)
    await user.click(await screen.findByTestId('guest-preview-review-keep'))
    await waitFor(() => expect(adapter.value()).toBeNull())
    await user.click(screen.getByTestId('guest-preview-review-continue'))
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith('/wardrobe?entry=add')
    )
    expect(api.nextStep).toHaveBeenCalledExactlyOnceWith('token-a', true)
  })

  it('drops the garment handoff when the member changes during the profile check', async () => {
    const user = userEvent.setup()
    await seedProposal(GUEST_PREVIEW_GARMENT_INTENT)
    server()
    const nextStep = Promise.withResolvers<string>()
    api.nextStep.mockReturnValue(nextStep.promise)
    render(<GuestPreviewReview />)

    await user.click(await screen.findByTestId('guest-preview-review-keep'))
    await user.click(screen.getByTestId('guest-preview-review-continue'))
    await waitFor(() =>
      expect(api.nextStep).toHaveBeenCalledExactlyOnceWith('token-a', true)
    )
    member.id = 'member-b'
    await act(async () => {
      nextStep.resolve('/wardrobe?entry=add')
      await nextStep.promise
    })

    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('returns to sign-in when the session ends before the garment handoff', async () => {
    const user = userEvent.setup()
    await seedProposal(GUEST_PREVIEW_GARMENT_INTENT)
    server()
    render(<GuestPreviewReview />)

    await user.click(await screen.findByTestId('guest-preview-review-keep'))
    member.id = null
    await user.click(screen.getByTestId('guest-preview-review-continue'))

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/signin')
    )
    expect(api.nextStep).not.toHaveBeenCalled()
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

  it('never shows account values read for a member who has since changed (L-G-A-B)', async () => {
    const client = server()
    client.read.mockImplementationOnce(() => {
      member.id = 'member-b'
      return Promise.resolve(ACCOUNT)
    })
    render(<GuestPreviewReview />)
    await waitFor(() => expect(client.read).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByTestId('guest-preview-review-account')).toBeNull()
  })

  // Session re-verification sets the member to null and back; only a settled different
  // member or a settled sign-out discards the proposal.
  const flipToNullAndBack = () => {
    member.id = null
    window.dispatchEvent(new Event('couture:session'))
    setTimeout(() => {
      member.id = 'member-a'
      window.dispatchEvent(new Event('couture:session'))
    }, 10)
  }

  it('reaches the review when the member flips to null and back during the read', async () => {
    const client = server()
    client.read.mockImplementationOnce(() => {
      flipToNullAndBack()
      return Promise.resolve(ACCOUNT)
    })
    render(<GuestPreviewReview />)
    expect(await screen.findByTestId('guest-preview-review-use')).toBeInTheDocument()
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(adapter.value()).not.toBeNull()
  })

  it('saves when the member flips to null and back during the save', async () => {
    const client = server()
    const commit = client.write.getMockImplementation()
    client.write.mockImplementationOnce((values) => {
      flipToNullAndBack()
      return commit?.(values) ?? Promise.resolve({ data: values })
    })
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-use'))
    expect(await screen.findByTestId('guest-preview-review-result')).toBeInTheDocument()
    expect(client.write).toHaveBeenCalledTimes(1)
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('discards the proposal when the read settles on a signed-out session', async () => {
    const client = server()
    client.read.mockImplementationOnce(() => {
      member.id = null
      return Promise.resolve(ACCOUNT)
    })
    render(<GuestPreviewReview />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    await waitFor(() => expect(adapter.value()).toBeNull())
    expect(screen.queryByTestId('guest-preview-review-account')).toBeNull()
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

describe('CC-7.21 first-run look review', () => {
  beforeEach(() => {
    lookApi.read.mockReset().mockResolvedValue(null)
    lookApi.style.mockReset().mockResolvedValue(undefined)
    lookApi.save.mockReset().mockResolvedValue({ id: 'look-saved' })
    notice.mockClear()
  })

  it.each(['use', 'keep'] as const)(
    'stores the exact look after the visitor chooses %s',
    async (choice) => {
      const conversion = await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
      if (conversion?.intent !== GUEST_PREVIEW_SAVE_INTENT)
        throw new Error('Missing review')
      const client = server()
      render(<GuestPreviewReview />)
      const proposed = await screen.findByTestId('guest-preview-review-proposed')
      expect(proposed).toHaveTextContent('Cozy')
      expect(proposed).toHaveTextContent('Colorful')
      expect(lookApi.save).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId(`guest-preview-review-${choice}`))
      await waitFor(() =>
        expect(navigation.replace).toHaveBeenCalledWith('/looks?segment=saved')
      )
      expect(lookApi.save).toHaveBeenCalledExactlyOnceWith(conversion.look, {
        accessToken: 'token-a',
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
    await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
    const client = server()
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-cancel'))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(client.write).not.toHaveBeenCalled()
    expect(lookApi.style).not.toHaveBeenCalled()
    expect(lookApi.save).not.toHaveBeenCalled()
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('retries the same chosen operation after a lost save response', async () => {
    await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
    lookApi.save.mockRejectedValueOnce(new Error('Response lost'))
    const client = server()
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-use'))
    await screen.findByTestId('guest-preview-review-failed')
    expect(screen.getByTestId('guest-preview-review-keep')).toBeDisabled()
    fireEvent.click(screen.getByTestId('guest-preview-review-use'))
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/looks?segment=saved')
    )
    expect(lookApi.save).toHaveBeenCalledTimes(2)
    expect(lookApi.save.mock.calls[1]).toEqual(lookApi.save.mock.calls[0])
    expect(client.write).toHaveBeenCalledOnce()
  })

  it('stops when another tab already claimed the guest save', async () => {
    await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
    const client = server()
    render(<GuestPreviewReview />)
    const use = await screen.findByTestId('guest-preview-review-use')
    await adapter.remove()
    fireEvent.click(use)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(client.write).not.toHaveBeenCalled()
    expect(lookApi.save).not.toHaveBeenCalled()
  })

  it('clears the visible review on a same-account session change in another tab', async () => {
    await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
    server()
    render(<GuestPreviewReview />)
    await screen.findByTestId('guest-preview-review-proposed')
    act(() => {
      member.revision += 1
      window.dispatchEvent(new Event('storage'))
    })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(screen.queryByTestId('guest-preview-review-proposed')).toBeNull()
    expect(lookApi.save).not.toHaveBeenCalled()
  })

  it('ends the review when the server refuses access to saved catalog looks', async () => {
    await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
    const client = server()
    lookApi.save.mockRejectedValueOnce(new SavedLookRequestError('Consent required', 403))
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-keep'))
    expect(await screen.findByTestId('guest-preview-review-result')).toHaveTextContent(
      en.review.rejected
    )
    expect(client.write).not.toHaveBeenCalled()
    expect(screen.queryByTestId('guest-preview-review-proposed')).toBeNull()
    expect(adapter.value()).toBeNull()
  })

  it('opens the saved look through its confirmation while the same session is active', async () => {
    await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
    server()
    render(<GuestPreviewReview />)
    fireEvent.click(await screen.findByTestId('guest-preview-review-keep'))
    await waitFor(() => expect(notice).toHaveBeenCalledOnce())
    const open = notice.mock.calls[0]?.[0].actions?.[0]?.onPress
    expect(open).toBeTypeOf('function')
    void open?.()
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/looks/saved/look-saved')
    member.revision += 1
    void open?.()
    expect(navigation.push).toHaveBeenCalledOnce()
  })

  it('offers Save look only when the account style read is unavailable', async () => {
    await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
    const client = server()
    lookApi.read.mockRejectedValueOnce(new Error('Style temporarily unavailable'))
    render(<GuestPreviewReview />)
    const use = await screen.findByTestId('guest-preview-review-use')
    expect(use).toBeDisabled()
    const keep = screen.getByTestId('guest-preview-review-keep')
    expect(keep).toBeEnabled()
    fireEvent.click(keep)
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/looks?segment=saved')
    )
    expect(client.write).not.toHaveBeenCalled()
    expect(lookApi.style).not.toHaveBeenCalled()
  })

  it('keeps the guest save available after a temporary storage read failure', async () => {
    await seedProposal(GUEST_PREVIEW_SAVE_INTENT)
    server()
    render(<GuestPreviewReview />)
    const keep = await screen.findByTestId('guest-preview-review-keep')
    vi.spyOn(adapter, 'read').mockRejectedValueOnce(new Error('Storage unavailable'))
    fireEvent.click(keep)
    await screen.findByTestId('guest-preview-review-failed')
    expect(lookApi.save).not.toHaveBeenCalled()
    expect(adapter.value()).toContain(GUEST_PREVIEW_SAVE_INTENT)
    fireEvent.click(keep)
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/looks?segment=saved')
    )
    expect(lookApi.save).toHaveBeenCalledOnce()
  })
})
