import type * as ReactNativeModule from 'react-native'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import {
  abortError,
  ResponseError,
  type PrepareShareCardInput,
} from '@couture/api-client'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import i18n from '@/src/lib/i18n'
const loadMocks = vi.hoisted(() => {
  // Expo packages read process.env.EXPO_OS when they load; the suite default is 'web'.
  process.env.EXPO_OS = 'ios'
  return () =>
    import('./share-card-composer.test-boundary.js').then(
      ({ composerMocks }) => composerMocks
    )
})
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
// The Android status-bar stack is a native window concern; Story 6.9 cases simulate Android.
vi.mock('@/src/lib/use-share-card-status-bar', () => ({
  useShareCardStatusBar: (open: boolean) => open,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
// Every mock below reads the shared boundary in share-card-composer.test-boundary.ts.
vi.mock('@/src/lib/mobile-auth', async () => (await loadMocks()).mobileAuth())
vi.mock('@/src/lib/share-cards', async () => (await loadMocks()).shareCards())
// Story 6.9: the real share flow runs against a mocked file system, digest and module.
vi.mock('@/src/lib/share-card-share', () =>
  vi.importActual('../src/lib/share-card-share.native')
)
vi.mock('../modules/share-card-native-share', async () =>
  (await loadMocks()).nativeShare()
)
vi.mock('@/src/analytics/mobile-analytics', async () => (await loadMocks()).analytics())
vi.mock('expo-file-system/legacy', async () => (await loadMocks()).fileSystem())
vi.mock('expo-crypto', async () => (await loadMocks()).crypto())
vi.mock('@/src/lib/share-card-save', async () => (await loadMocks()).save())
vi.mock('@/src/lib/accessibility-focus', async () =>
  (await loadMocks()).accessibilityFocusHandles()
)
vi.mock('../modules/accessibility-focus', async () =>
  (await loadMocks()).accessibilityFocusModule()
)
vi.mock('./edge-to-edge-modal', async () => (await loadMocks()).modal())
vi.mock('react-native', async (original) =>
  (await loadMocks()).reactNative(await original<typeof ReactNativeModule>())
)
import { feedbackSlotHeight, revealScrollOffset } from './share-card-composer'
import { nativeShareCardSavePending } from '@/src/lib/share-card-save-operations'
import { drainMacrotask } from '@/src/test-utils/drain-macrotask'
import { unhandledRejectionsDuring } from '@/src/test-utils/unhandled-rejections'
import {
  announced,
  boundary,
  changeIdentity,
  deferred,
  expectSaveUsable,
  Harness,
  installComposerHooks,
  purposes,
  ready,
  readyShare,
  setOS,
  settledEvent,
  settleShareAttempt,
  shareCaptures,
  shareFiles,
  source,
  tapShare,
} from './share-card-composer.test-support'

/** Story 6.9 composer Share and layout cases; the 6.8 lifecycle lives in the sibling file. */
installComposerHooks()

/** The composer's error colour, #7A1F2D. */
const MERLOT = 'rgb(122, 31, 45)'

describe('Story 6.9 composer Share', () => {
  it('C-COMP-SHARE-GATE: Share renders only for the current member with capability on and the module present', async () => {
    render(<Harness />)
    await ready()
    expect(boundary.capabilities).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    cleanup()
    boundary.prepare.mockClear()
    boundary.capabilities.mockResolvedValue({ nativeShare: true })
    render(<Harness />)
    expect(await screen.findByTestId('share-card-share')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    // Disabled until the preview validates; a press emits nothing and sends no prepare.
    await userEvent.click(screen.getByTestId('share-card-share'), { force: true })
    expect(purposes()).toEqual(['preview'])
    await ready()
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    expect(screen.getByTestId('share-card-share')).toHaveTextContent(
      i18n.t('shareCard.share')
    )
    expect(boundary.capture).not.toHaveBeenCalled()
  })
  it.each([
    ['a rejected read', () => Promise.reject(new Error('timeout'))],
    ['an off answer', () => Promise.resolve({ nativeShare: false })],
    ['a malformed answer', () => Promise.resolve({ nativeShare: 'yes' })],
  ])('C-COMP-SHARE-GATE: %s hides Share and keeps Save', async (_name, answer) => {
    let read: Promise<unknown> | undefined
    boundary.capabilities.mockImplementation(() => (read = answer()))
    render(<Harness />)
    await ready()
    await waitFor(() => expect(boundary.capabilities).toHaveBeenCalledOnce())
    // The composer's own handlers were attached first; the macrotask drains their chain.
    await act(async () => {
      await read?.catch(() => undefined)
      await drainMacrotask()
    })
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    expect(screen.getByTestId('share-card-save')).toBeInTheDocument()
  })
  it('C-COMP-SHARE-GATE: identity change clears capability and a late answer for the previous member is ignored', async () => {
    const first = deferred<{ nativeShare: boolean }>()
    const second = deferred<{ nativeShare: boolean }>()
    boundary.capabilities
      .mockResolvedValueOnce({ nativeShare: true })
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    render(<Harness />)
    expect(await screen.findByTestId('share-card-share')).toBeInTheDocument()
    changeIdentity('member-b')
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    changeIdentity('member-c')
    await act(async () => {
      first.resolve({ nativeShare: true })
      await first.promise
    })
    // member-b's answer arrived while member-c is signed in.
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    changeIdentity(null)
    await act(async () => {
      second.resolve({ nativeShare: true })
      await second.promise
    })
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    expect(boundary.capabilities).toHaveBeenCalledTimes(3)
  })
  it('C-COMP-SHARE-GATE: an absent module shows a statically disabled Share with its reason, and presses do nothing', async () => {
    boundary.shareModule = false
    boundary.capabilities.mockResolvedValue({ nativeShare: true })
    render(<Harness />)
    await ready()
    const share = await screen.findByTestId('share-card-share')
    expect(share).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('share-card-share-unavailable')).toHaveTextContent(
      i18n.t('shareCard.shareUnavailable')
    )
    await userEvent.click(share, { force: true })
    await act(async () => {
      await Promise.resolve()
    })
    expect(boundary.prepare).toHaveBeenCalledOnce()
    expect(boundary.shareFile).not.toHaveBeenCalled()
    expect(boundary.capture).not.toHaveBeenCalled()
    expect(shareFiles()).toEqual([])
  })
  it('C-COMP-SHARE-COMPLETED: iOS completed announces Shared once, focuses Share and records instagram/completed', async () => {
    await readyShare()
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
    expect(boundary.prepare.mock.calls[1]?.[0]).toMatchObject({
      purpose: 'share',
      expectedSha256: card.sha256,
    })
    const [uri, digest] = boundary.shareFile.mock.calls[0] as [string, string]
    expect(uri).toMatch(/cc69-share-/)
    expect(digest).toBe(card.sha256)
    await waitFor(() =>
      expect(announced('shared')).toEqual([[i18n.t('shareCard.shared'), { queue: true }]])
    )
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
    await settledEvent({ client: 'ios', target: 'instagram', outcome: 'completed' })
    expectSaveUsable()
  })
  it('C-COMP-SHARE-CHOSEN: Android target chosen says Sent to the app, never Shared, and records pinterest/target_chosen', async () => {
    setOS('android')
    boundary.shareFile.mockResolvedValue({
      target: 'pinterest',
      outcome: 'target_chosen',
    })
    await readyShare()
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.sentToApp'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shareCard.shared'))).not.toBeInTheDocument()
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
    await settledEvent({
      client: 'android',
      target: 'pinterest',
      outcome: 'target_chosen',
    })
    // The handoff file stays leased after settlement while the lock is already released.
    expect(shareFiles()).toHaveLength(1)
    expectSaveUsable()
  })
  it('U-SHARE-LEASE: closing the composer after the Android handoff keeps the leased file once the chooser settles', async () => {
    setOS('android')
    const native = deferred<unknown>()
    boundary.shareFile.mockReturnValue(native.promise)
    await readyShare()
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => {
      native.resolve({ target: 'pinterest', outcome: 'target_chosen' })
      await native.promise
    })
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
    // The member is unchanged, so the closed composer's attempt still records once.
    await settledEvent({
      client: 'android',
      target: 'pinterest',
      outcome: 'target_chosen',
    })
    await settleShareAttempt()
    // The receiving app may still be reading it: only the 30-minute lease sweep deletes it.
    expect(shareFiles()).toHaveLength(1)
    expect(boundary.deleted.filter((uri) => uri.includes('cc69-share-'))).toEqual([])
    expect(nativeShareCardSavePending()).toBe(false)
  })
  it('C-COMP-SHARE-OTHER: iOS completed into an unknown target says Sent to the app, never Shared', async () => {
    boundary.shareFile.mockResolvedValue({ target: 'other', outcome: 'completed' })
    await readyShare()
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.sentToApp'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shareCard.shared'))).not.toBeInTheDocument()
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
    await settledEvent({ client: 'ios', target: 'other', outcome: 'completed' })
    expectSaveUsable()
  })
  it.each([
    ['ios', { target: 'pinterest', outcome: 'cancelled' }],
    ['ios', { target: 'none', outcome: 'cancelled' }],
    ['android', { target: 'none', outcome: 'not_confirmed' }],
  ])(
    'C-COMP-SHARE-CLOSED: %s %j keeps the composition and returns focus to Share',
    async (os, result) => {
      setOS(os)
      boundary.shareFile.mockResolvedValue(result)
      await readyShare()
      await userEvent.click(screen.getByTestId('share-card-watermark'))
      await ready()
      await waitFor(() =>
        expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
          'aria-disabled',
          'true'
        )
      )
      await tapShare()
      expect(await screen.findByText(i18n.t('shareCard.shareClosed'))).toBeInTheDocument()
      // A closed sheet is polite status copy, never the merlot alert.
      expect(screen.getByTestId('share-card-feedback')).toHaveTextContent(
        i18n.t('shareCard.shareClosed')
      )
      expect(screen.queryByTestId('share-card-error')).not.toBeInTheDocument()
      expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()
      expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
        'aria-checked',
        'false'
      )
      expect(boundary.prepare.mock.calls.at(-1)?.[0]).toMatchObject({
        purpose: 'share',
        watermark: false,
        source,
      })
      await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
      await settledEvent({ client: os, ...result })
      expectSaveUsable()
    }
  )
  it.each([
    ['native error', () => boundary.shareFile.mockRejectedValue(new Error('bridge'))],
    ['write error', () => boundary.write.mockRejectedValue(new Error('disk_full'))],
    [
      '403',
      () =>
        boundary.prepare
          .mockResolvedValueOnce(card)
          .mockRejectedValueOnce(new ResponseError(new Response('{}', { status: 403 }))),
    ],
    [
      'offline',
      () =>
        boundary.prepare
          .mockResolvedValueOnce(card)
          .mockRejectedValueOnce(new Error('offline')),
    ],
    [
      // The client's own deadline aborts the request while the composer stays current.
      'request deadline',
      () =>
        boundary.prepare
          .mockResolvedValueOnce(card)
          .mockRejectedValueOnce(abortError('Request deadline')),
    ],
  ])(
    'C-COMP-SHARE-FAIL: %s shows merlot shareFailed, focuses Save and keeps the preview',
    async (_name, arrange) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      arrange()
      await readyShare()
      await tapShare()
      const error = await screen.findByTestId('share-card-error')
      expect(error).toHaveTextContent(i18n.t('shareCard.shareFailed'))
      expect(error).toHaveAttribute('role', 'alert')
      expect(getComputedStyle(error).color).toBe(MERLOT)
      expect(screen.queryByTestId('share-card-retry')).not.toBeInTheDocument()
      expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()
      await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(42))
      await settledEvent({ client: 'ios', target: 'none', outcome: 'failed' })
      expectSaveUsable()
    }
  )
  it('C-COMP-SHARE-GATE: a share_disabled 403 hides Share for this member and keeps Save', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await readyShare()
    boundary.prepare.mockRejectedValueOnce(
      new ResponseError(
        new Response(JSON.stringify({ code: 'share_disabled' }), { status: 403 })
      )
    )
    await tapShare()
    expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
      i18n.t('shareCard.shareFailed')
    )
    await waitFor(() =>
      expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    )
    await settledEvent({ client: 'ios', target: 'none', outcome: 'failed' })
    expectSaveUsable()
    // A plain 403 keeps Share: only the flag refusal revokes the capability.
    cleanup()
    boundary.prepare.mockReset().mockResolvedValue(card)
    await readyShare()
    const plain = new Response('{}', { status: 403 })
    // The composer reads the refusal from a clone of the body; that read is the settle signal.
    let bodyRead: Promise<unknown> | undefined
    const cloneBody = plain.clone.bind(plain)
    plain.clone = () => {
      const copy = cloneBody()
      const json = copy.json.bind(copy)
      copy.json = () => (bodyRead = json())
      return copy
    }
    boundary.prepare.mockRejectedValueOnce(new ResponseError(plain))
    await tapShare()
    expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
      i18n.t('shareCard.shareFailed')
    )
    await waitFor(() => expect(bodyRead).toBeDefined())
    await act(async () => {
      await bodyRead
      await drainMacrotask()
    })
    expect(screen.getByTestId('share-card-share')).toBeInTheDocument()
  })
  it('C-COMP-SHARE-UNAVAILABLE: a runtime unavailable result says so, focuses Save and records one event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setOS('android')
    boundary.shareFile.mockResolvedValue({
      target: 'none',
      outcome: 'unavailable',
      code: 'chooser_unavailable',
    })
    await readyShare()
    await tapShare()
    expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
      i18n.t('shareCard.shareUnavailable')
    )
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(42))
    await settledEvent({ client: 'android', target: 'none', outcome: 'unavailable' })
    await settleShareAttempt()
    expect(shareCaptures()).toHaveLength(1)
    expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()
    expectSaveUsable()
  })
  it('C-COMP-SHARE-STALE: 409 keeps the 6.8 stale path, disables Save and Share until a fresh preview, and records failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await readyShare()
    boundary.prepare.mockRejectedValueOnce(
      new ResponseError(new Response('{}', { status: 409 }))
    )
    await tapShare()
    expect(
      await screen.findByText(i18n.t('shareCard.previewChanged'))
    ).toBeInTheDocument()
    // Refresh (46), never Retry (43): the stale path offers a fresh preview.
    await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(46))
    expect(screen.getByAltText(card.accessibilityLabel)).toBeInTheDocument()
    expect(screen.getByTestId('share-card-save')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('share-card-share')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(boundary.shareFile).not.toHaveBeenCalled()
    await settledEvent({ client: 'ios', target: 'none', outcome: 'failed' })
    await userEvent.click(screen.getByTestId('share-card-refresh'))
    await ready()
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
  })
  it('C-COMP-SHARE-ONE-EVENT: closing during the share prepare still records one failed event', async () => {
    await readyShare()
    boundary.prepare.mockImplementationOnce(
      (_input: PrepareShareCardInput, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError('cancelled')), {
            once: true,
          })
        })
    )
    await tapShare()
    await waitFor(() => expect(purposes()).toEqual(['preview', 'share']))
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    // Only an identity change suppresses the event; a closed composer is not one.
    await settledEvent({ client: 'ios', target: 'none', outcome: 'failed' })
    expect(boundary.shareFile).not.toHaveBeenCalled()
    expect(nativeShareCardSavePending()).toBe(false)
  })
  it('C-COMP-SHARE-IDENTITY: sign-out while the sheet is open clears the preview and drops the late result', async () => {
    const native = deferred<unknown>()
    boundary.shareFile.mockReturnValue(native.promise)
    await readyShare()
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    changeIdentity(null)
    expect(screen.queryByTestId('share-card-preview-loaded')).not.toBeInTheDocument()
    boundary.announce.mockClear()
    await act(async () => {
      native.resolve({ target: 'instagram', outcome: 'completed' })
      await native.promise
    })
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
    await settleShareAttempt()
    expect(screen.queryByText(i18n.t('shareCard.shared'))).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-card-feedback')).not.toBeInTheDocument()
    expect(boundary.announce).not.toHaveBeenCalled()
    expect(boundary.capture).not.toHaveBeenCalled()
    expect(shareFiles()).toHaveLength(1)
  })
  it.each([
    ['a member change', ['member-b']],
    ['a sign-out and return as the same member', [null, 'member-a']],
  ])(
    'C-COMP-SHARE-IDENTITY: an unmounted composer drops a late result after %s',
    async (_, members) => {
      const native = deferred<unknown>()
      boundary.shareFile.mockReturnValue(native.promise)
      await readyShare()
      await tapShare()
      await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
      // Unmounted first, so no member effect runs to advance the composer's epoch.
      cleanup()
      for (const member of members) changeIdentity(member)
      await act(async () => {
        native.resolve({ target: 'instagram', outcome: 'completed' })
        await native.promise
      })
      await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
      await settleShareAttempt()
      expect(boundary.capture).not.toHaveBeenCalled()
    }
  )
  it.each(['throws', 'rejects'])(
    'C-COMP-SHARE-ANALYTICS-DOWN: a capture that %s leaves copy, focus and the lock unchanged',
    async (mode) => {
      // A plain function, never a vi.fn: see unhandledRejectionsDuring.
      boundary.captureResult = () => {
        if (mode === 'throws') throw new Error('analytics down')
        return Promise.reject(new Error('analytics down'))
      }
      const unhandled = await unhandledRejectionsDuring(async () => {
        await readyShare()
        await tapShare()
        expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
        await waitFor(() => expect(boundary.capture).toHaveBeenCalledOnce())
        await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
        expectSaveUsable()
        await userEvent.click(screen.getByTestId('share-card-save'))
        expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
      })
      expect(unhandled).toEqual([])
    }
  )
  it('C-COMP-SHARE-ONE-EVENT: duplicate taps are ignored, nothing is recorded before settlement, and Share blocks Save', async () => {
    const native = deferred<unknown>()
    boundary.shareFile.mockReturnValue(native.promise)
    await readyShare()
    const share = screen.getByTestId('share-card-share')
    act(() => {
      share.click()
      share.click()
    })
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    expect(screen.getByText(i18n.t('shareCard.sharing'))).toBeInTheDocument()
    await userEvent.click(share, { force: true })
    await userEvent.click(screen.getByTestId('share-card-save'), { force: true })
    expect(boundary.permission).not.toHaveBeenCalled()
    expect(boundary.save).not.toHaveBeenCalled()
    expect(boundary.capture).not.toHaveBeenCalled()
    expect(nativeShareCardSavePending()).toBe(true)
    await act(async () => {
      native.resolve({ target: 'none', outcome: 'cancelled' })
      await native.promise
    })
    await settledEvent({ client: 'ios', target: 'none', outcome: 'cancelled' })
    expect(purposes()).toEqual(['preview', 'share'])
    await settleShareAttempt()
    expect(shareCaptures()).toHaveLength(1)
  })
  it('C-COMP-SHARE-ANCHOR: every attempt passes the Share frame measured at handoff', async () => {
    await readyShare()
    const button: HTMLElement & {
      measureInWindow?: (callback: (...frame: number[]) => void) => void
    } = screen.getByTestId('share-card-share')
    const frames = [
      [16, 600, 343, 48],
      [16, 664, 343, 48],
    ]
    let attempt = 0
    button.measureInWindow = (callback) => callback(...frames[attempt]!)
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
    expect(boundary.shareFile.mock.calls[0]?.[2]).toEqual({
      x: 16,
      y: 600,
      width: 343,
      height: 48,
    })
    // Long copy that wraps can still move the button: the next attempt measures again.
    attempt = 1
    await waitFor(() => expect(shareCaptures()).toHaveLength(1))
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledTimes(2))
    expect(boundary.shareFile.mock.calls[1]?.[2]).toEqual({
      x: 16,
      y: 664,
      width: 343,
      height: 48,
    })
  })
  it('C-COMP-SHARE-ANCHOR: the anchor is the real window frame after the pending copy renders', async () => {
    const frames: DOMRect[] = []
    boundary.shareFile.mockImplementation(() => {
      frames.push(screen.getByTestId('share-card-share').getBoundingClientRect())
      return Promise.resolve({ target: 'none', outcome: 'cancelled' })
    })
    await readyShare()
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    const anchor = boundary.shareFile.mock.calls[0]?.[2] as Record<string, number>
    expect(anchor.x).toBeCloseTo(frames[0]!.left, 0)
    expect(anchor.y).toBeCloseTo(frames[0]!.top, 0)
    expect(anchor.width).toBeCloseTo(frames[0]!.width, 0)
    expect(anchor.height).toBeCloseTo(frames[0]!.height, 0)
  })
  it('C-COMP-SHARE-A11Y: 44-point target, one announcement, Back keeps the operation, neutral finishing copy', async () => {
    const native = deferred<unknown>()
    boundary.shareFile.mockReturnValue(native.promise)
    await readyShare()
    expect(
      screen.getByTestId('share-card-share').getBoundingClientRect().height
    ).toBeGreaterThanOrEqual(44)
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    // Android Back and Cancel share the modal's close handler.
    await userEvent.click(screen.getByTestId('share-card-cancel'))
    expect(nativeShareCardSavePending()).toBe(true)
    await userEvent.click(screen.getByText('Reopen'))
    expect(await screen.findByText(i18n.t('shareCard.finishingSave'))).toBeInTheDocument()
    expect(i18n.t('shareCard.finishingSave')).not.toMatch(/save|share/i)
    await act(async () => {
      native.resolve({ target: 'instagram', outcome: 'completed' })
      await native.promise
    })
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
    // The member is unchanged, so the closed composer's attempt still records once.
    await settledEvent({ client: 'ios', target: 'instagram', outcome: 'completed' })
    expect(announced('shared')).toEqual([])
    await ready()
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    boundary.shareFile.mockResolvedValue({ target: 'facebook', outcome: 'completed' })
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.shared'))).toBeInTheDocument()
    await waitFor(() => expect(shareCaptures()).toHaveLength(2))
    await settleShareAttempt()
    expect(announced('shared')).toHaveLength(1)
  })
  it('C-COMP-SHARE-A11Y: Android Back while the chooser is open closes the composer and keeps the operation', async () => {
    setOS('android')
    const native = deferred<unknown>()
    boundary.shareFile.mockReturnValue(native.promise)
    await readyShare()
    await tapShare()
    await waitFor(() => expect(boundary.shareFile).toHaveBeenCalledOnce())
    // The modal's onRequestClose is what Android Back invokes; Cancel is its own button.
    expect(boundary.requestClose).toBeTypeOf('function')
    act(() => boundary.requestClose!())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(nativeShareCardSavePending()).toBe(true)
    await userEvent.click(screen.getByText('Reopen'))
    expect(await screen.findByText(i18n.t('shareCard.finishingSave'))).toBeInTheDocument()
    expect(boundary.shareFile).toHaveBeenCalledOnce()
    await act(async () => {
      native.resolve({ target: 'pinterest', outcome: 'target_chosen' })
      await native.promise
    })
    await waitFor(() => expect(nativeShareCardSavePending()).toBe(false))
    await settledEvent({
      client: 'android',
      target: 'pinterest',
      outcome: 'target_chosen',
    })
    expect(boundary.shareFile).toHaveBeenCalledOnce()
  })
})

describe('Story 6.9 composer layout', () => {
  afterEach(async () => {
    await browserPage.viewport(414, 896)
  })
  const frame = (id: string) => screen.getByTestId(id).getBoundingClientRect()
  const tops = () => ({
    save: frame('share-card-save').top,
    share: frame('share-card-share').top,
  })
  it('C-COMP-LAYOUT-STABLE: Save and Share keep their frames while feedback appears and changes', async () => {
    const shared = deferred<unknown>()
    boundary.shareFile.mockReturnValue(shared.promise)
    const saved = deferred<void>()
    boundary.save.mockReturnValue(saved.promise)
    await readyShare()
    // The resting slot reserves its lines with no node in it: a hidden placeholder Text made
    // Android TalkBack leave the title for the next element when the composer opened.
    expect(screen.queryByTestId('share-card-feedback')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-card-error')).not.toBeInTheDocument()
    const slot = screen.getByTestId('share-card-save').previousElementSibling
    expect(slot?.childElementCount).toBe(0)
    expect(slot?.textContent).toBe('')
    expect(slot?.getBoundingClientRect().height).toBeGreaterThan(0)
    const resting = tops()
    await tapShare()
    expect(await screen.findByText(i18n.t('shareCard.sharing'))).toBeInTheDocument()
    expect(tops()).toEqual(resting)
    await act(async () => {
      shared.resolve({ target: 'none', outcome: 'cancelled' })
      await shared.promise
    })
    expect(await screen.findByText(i18n.t('shareCard.shareClosed'))).toBeInTheDocument()
    expect(tops()).toEqual(resting)
    await waitFor(expectSaveUsable)
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByText(i18n.t('shareCard.saving'))).toBeInTheDocument()
    expect(tops()).toEqual(resting)
    await act(async () => {
      saved.resolve()
      await saved.promise
    })
    expect(await screen.findByText(i18n.t('shareCard.saved'))).toBeInTheDocument()
    expect(tops()).toEqual(resting)
  })
  it('C-COMP-LAYOUT-STABLE: a one-line error takes the same slot and Retry follows Share', async () => {
    boundary.save.mockRejectedValue(new Error('render'))
    await readyShare()
    const resting = tops()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
      i18n.t('shareCard.render')
    )
    expect(screen.getByTestId('share-card-retry')).toBeInTheDocument()
    expect(tops()).toEqual(resting)
  })
  it('C-COMP-LAYOUT-STABLE: the slot reserves exactly two lines and two-line copy moves nothing', async () => {
    await readyShare()
    const slot = screen.getByTestId('share-card-save').previousElementSibling
    expect(slot?.getBoundingClientRect().height).toBe(44)
    const resting = tops()
    boundary.shareFile.mockResolvedValue({ target: 'none', outcome: 'cancelled' })
    await tapShare()
    expect(await screen.findByTestId('share-card-feedback')).toHaveTextContent(
      i18n.t('shareCard.shareClosed')
    )
    expect(frame('share-card-feedback').height).toBe(22)
    expect(tops()).toEqual(resting)
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    boundary.shareFile.mockResolvedValue({ target: 'none', outcome: 'failed' })
    await tapShare()
    expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
      i18n.t('shareCard.shareFailed')
    )
    // The failure copy really wraps, and the reservation already held its second line.
    expect(frame('share-card-error').height).toBe(44)
    expect(tops()).toEqual(resting)
    expect(slot?.getBoundingClientRect().height).toBe(44)
  })
  it('C-COMP-LAYOUT-STABLE: a 320-pt window reserves three lines and keeps the actions still', async () => {
    await browserPage.viewport(320, 700)
    await i18n.changeLanguage('de-DE')
    boundary.save.mockRejectedValue(new Error('storage'))
    await readyShare()
    const slot = screen.getByTestId('share-card-save').previousElementSibling
    expect(slot?.getBoundingClientRect().height).toBe(66)
    const resting = tops()
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
      i18n.t('shareCard.storage')
    )
    expect(frame('share-card-error').height).toBeGreaterThan(22)
    expect(tops()).toEqual(resting)
  })
  it('U-COMP-FEEDBACK-SLOT: the reservation follows the column and scales with the font', () => {
    // Every phone from 360 pt up, and the 420-pt capped column, fits all copy on two lines.
    expect(feedbackSlotHeight(360, 1, 3)).toBe(44)
    expect(feedbackSlotHeight(402, 1, 3)).toBe(44)
    expect(feedbackSlotHeight(1180, 1, 2)).toBe(44)
    // A 320-pt window's 272-pt column needs three lines for de-DE and pt `storage`.
    expect(feedbackSlotHeight(320, 1, 2)).toBe(66)
    // Android rounds each 57.75-px line up to 58 px at 2.625x, and so does the reservation.
    expect(feedbackSlotHeight(411, 1, 2.625) * 2.625).toBeCloseTo(116)
    // Larger text narrows the column in effect and scales each line.
    expect(feedbackSlotHeight(402, 1.1, 3) * 3).toBeCloseTo(146)
    expect(feedbackSlotHeight(402, 1.5, 3)).toBeCloseTo(99)
    expect(feedbackSlotHeight(1180, 2, 2)).toBeCloseTo(132)
  })
  it('C-COMP-LAYOUT-REVEAL: a failure that focuses Retry below the fold scrolls Retry into view', async () => {
    // A short phone window: Share, added after Save, leaves Retry under the fold. Focus moves to
    // Retry, so a sighted member must see it too (iOS 26.1, ShareCardAccessibilityUITests
    // storage-failure: Retry existed but was not hittable). The mocked modal is a plain div, so
    // this test bounds it to the window like the native modal, making the ScrollView scroll.
    const bounded = document.createElement('style')
    bounded.textContent =
      '[role="dialog"] { height: 100vh; display: flex; flex-direction: column; }'
    document.head.append(bounded)
    try {
      await browserPage.viewport(390, 700)
      boundary.save.mockRejectedValue(new Error('storage'))
      await readyShare()
      expect(frame('share-card-share').bottom).toBeGreaterThan(window.innerHeight)
      await userEvent.click(screen.getByTestId('share-card-save'))
      expect(await screen.findByTestId('share-card-error')).toHaveTextContent(
        i18n.t('shareCard.storage')
      )
      await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(43))
      await waitFor(() => {
        const retry = frame('share-card-retry')
        expect(retry.top).toBeGreaterThanOrEqual(0)
        expect(retry.bottom).toBeLessThanOrEqual(window.innerHeight)
      })
    } finally {
      bounded.remove()
    }
  })
  it('C-COMP-LAYOUT-REVEAL: a result that focuses Share resting just above the fold scrolls nothing', async () => {
    // iPhone 17 Pro: Share rests 2 pt above the fold. Focus returns to it after shareClosed, and
    // a reveal with its 8-pt margin scrolled the whole composer up 6 pt.
    const bounded = document.createElement('style')
    bounded.textContent =
      '[role="dialog"] { height: 100vh; display: flex; flex-direction: column; }'
    document.head.append(bounded)
    try {
      await browserPage.viewport(390, 1200)
      boundary.shareFile.mockResolvedValue({ target: 'none', outcome: 'cancelled' })
      await readyShare()
      let scroller = screen.getByTestId('share-card-share').parentElement
      while (
        scroller &&
        !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)
      )
        scroller = scroller.parentElement
      const padding = window.innerHeight - scroller!.getBoundingClientRect().bottom
      await browserPage.viewport(
        390,
        Math.ceil(frame('share-card-share').bottom + 4 + padding)
      )
      const fold = scroller!.getBoundingClientRect().bottom
      expect(frame('share-card-share').bottom).toBeLessThanOrEqual(fold)
      expect(frame('share-card-share').bottom).toBeGreaterThan(fold - 8)
      const resting = tops()
      // Share is measured twice: the anchor at handoff, then the reveal after focus returns.
      // The reveal's callback is the settle signal; its scroll, if any, follows in microtasks.
      const share: HTMLElement & {
        measureInWindow?: (callback: (...frame: number[]) => void) => void
      } = screen.getByTestId('share-card-share')
      const measure = share.measureInWindow!.bind(share)
      let measured = 0
      share.measureInWindow = (callback) =>
        measure((...frame) => {
          callback(...frame)
          measured += 1
        })
      await tapShare()
      expect(await screen.findByTestId('share-card-feedback')).toHaveTextContent(
        i18n.t('shareCard.shareClosed')
      )
      await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(45))
      await waitFor(() => expect(measured).toBe(2))
      await act(drainMacrotask)
      expect(scroller!.scrollTop).toBe(0)
      expect(tops()).toEqual(resting)
    } finally {
      bounded.remove()
    }
  })
  it('U-COMP-LAYOUT-REVEAL: visibility is judged where the content rests, never mid-bounce', () => {
    // iPhone 17 Pro: the ScrollView spans y 78 to 824 and Share rests at 773 to 822.
    const viewport = { x: 0, y: 78, width: 402, height: 746 }
    const share = { x: 24, y: 773, width: 354, height: 49.33 }
    expect(revealScrollOffset(viewport, share, 0)).toBeNull()
    // The swipe that dismissed the iOS share sheet left a 147.67-pt rubber-band pull as the
    // result arrived (iOS 26.1 measurement). The content springs back, so nothing scrolls.
    expect(
      revealScrollOffset(viewport, { ...share, y: 773 + 147.67 }, -147.67)
    ).toBeNull()
    // A target under the fold still scrolls fully into view with its 8-pt margin.
    expect(revealScrollOffset(viewport, { ...share, y: 838 }, 0)).toBeCloseTo(71.33)
  })
  it.each([
    ['a phone', 414, 896],
    ['the largest phone', 440, 956],
  ])(
    'C-COMP-LAYOUT-WIDTH: %s keeps the full-width column and preview',
    async (_name, width, height) => {
      await browserPage.viewport(width, height)
      await readyShare()
      const column = screen.getByRole('dialog').getBoundingClientRect().width - 48
      expect(frame('share-card-save').width).toBeCloseTo(column, 0)
      expect(frame('share-card-preview-loaded').width).toBeCloseTo(column, 0)
    }
  )
  it.each([
    ['an iPad in portrait', 820, 1180, 420],
    // 45% of an 820-pt-high window: a 369-pt-high preview, 295 pt wide.
    ['an iPad in landscape', 1180, 820, 295],
  ])(
    'C-COMP-LAYOUT-WIDTH: %s centers a 420-pt column and keeps every action on screen',
    async (_name, width, height, preview) => {
      await browserPage.viewport(width, height)
      await readyShare()
      const dialog = screen.getByRole('dialog').getBoundingClientRect()
      for (const id of ['share-card-save', 'share-card-share', 'share-card-cancel']) {
        const action = frame(id)
        expect(action.width).toBeCloseTo(420, 0)
        expect(action.left - dialog.left).toBeCloseTo(dialog.right - action.right, 0)
      }
      const image = frame('share-card-preview-loaded')
      expect(image.width).toBeCloseTo(preview, 0)
      expect(image.left - dialog.left).toBeCloseTo(dialog.right - image.right, 0)
      expect(frame('share-card-cancel').bottom).toBeLessThanOrEqual(window.innerHeight)
    }
  )
})
