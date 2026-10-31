/**
 * Story 6.9 C-WEB-SHARE-DIALOG: Web Share beside Download. The Story 6.8 save tests live in
 * share-card-dialog.test.tsx; both files share src/test-utils/share-card-dialog.tsx.
 *
 * The share helpers in lib/share-cards are wrapped so each test can await the exact
 * promise the dialog awaits (the capability answer, the share prepare, the handoff)
 * before it asserts that nothing else happened. No absence check rests on a sleep.
 */
import { createHash } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { http, HttpResponse } from 'msw'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  endpoint,
  handoff,
  open,
  requests,
  setupShareCardDialog,
  source,
} from '../../test-utils/share-card-dialog'
import { currentI18n } from '../../i18n'
import enUS from '../../i18n/locales/en-US.json'
import frFR from '../../i18n/locales/fr-FR.json'
import { browserAnalytics } from '../../analytics/browser-analytics'
import type * as ShareCards from '../../lib/share-cards'
import { SHARE_CARD_CAPABILITIES_DEADLINE_MS } from '@couture/api-client'
import { SHARE_AUTHORIZATION_TTL_MS, ShareCardControl } from './share-card-dialog'
const identity = vi.hoisted(() => ({ member: 'member-one' as string | null }))
vi.mock('../../lib/web-session', () => ({ webSessionIdentity: () => identity.member }))
// Every promise the dialog received from these helpers, in call order. A plain wrapper,
// not vi.fn: a spy subscribes to each returned promise and would handle a rejection the
// dialog forgot to.
const settled = vi.hoisted(() => ({
  capabilities: [] as Promise<unknown>[],
  authorizations: [] as Promise<unknown>[],
  handoffs: [] as Promise<unknown>[],
  // Replaces the real capability read for one test; the real client never lets a late
  // answer through after an abort, so only a stand-in can reach the dialog's own guard.
  capabilityRead: null as
    | null
    | ((signal: AbortSignal) => Promise<{ nativeShare: boolean }>),
}))
vi.mock('../../lib/share-cards', async (importOriginal) => {
  const actual = await importOriginal<typeof ShareCards>()
  const recorded =
    <A extends unknown[], R>(
      list: Promise<unknown>[],
      call: (...args: A) => Promise<R>
    ) =>
    (...args: A) => {
      const result = call(...args)
      list.push(result)
      return result
    }
  return {
    ...actual,
    shareCardCapabilitiesFromWeb: recorded(settled.capabilities, (signal: AbortSignal) =>
      settled.capabilityRead
        ? settled.capabilityRead(signal)
        : actual.shareCardCapabilitiesFromWeb(signal)
    ),
    authorizeShareCardFile: recorded(
      settled.authorizations,
      actual.authorizeShareCardFile
    ),
    handOffShareCardFile: recorded(settled.handoffs, actual.handOffShareCardFile),
  }
})
setupShareCardDialog(identity)
beforeEach(() => {
  settled.capabilities.length = 0
  settled.authorizations.length = 0
  settled.handoffs.length = 0
  settled.capabilityRead = null
})
/**
 * Waits until the dialog has received promise number `index` from `list`, then lets it
 * settle inside act. The dialog subscribed first, so its continuation and the React
 * updates it schedules have run by the time this returns.
 */
async function settle(list: Promise<unknown>[], index: number) {
  await waitFor(() => expect(list.length).toBeGreaterThan(index))
  await act(async () => {
    await list[index]!.catch(() => undefined)
  })
}
const capabilitiesEndpoint = 'http://localhost:3001/api/v1/share-cards/capabilities'
type ShareResponder = (body: { purpose: string }) => Response | Promise<Response>
const approved = () => HttpResponse.json({ data: preparedShareCardFixture })
function useShareHandlers(
  respond: ShareResponder = approved,
  capability: () => Response | Promise<Response> = () =>
    HttpResponse.json({ data: { nativeShare: true } })
) {
  const capabilityRequests: (string | null)[] = []
  useMswHandlers(
    http.get(capabilitiesEndpoint, async () => {
      capabilityRequests.push(identity.member)
      return capability()
    }),
    http.post(endpoint, async ({ request }) => {
      const body = (await request.json()) as { purpose: string }
      requests.push(body)
      return body.purpose === 'preview' ? approved() : respond(body)
    })
  )
  return capabilityRequests
}
const webShare = vi.fn<(data: { files: File[] }) => Promise<void>>()
const canShare = vi.fn<(data: { files: File[] }) => boolean>()
const shareError = (name: string) => Promise.reject(new DOMException(name, name))
const fileDigest = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(
        createHash('sha256')
          .update(new Uint8Array(reader.result as ArrayBuffer))
          .digest('hex')
      )
    reader.readAsArrayBuffer(file)
  })
// Ready means neither disabled nor busy: Share is aria-disabled while anything runs.
async function openWithShare() {
  const image = await open()
  fireEvent.load(image)
  const button = await screen.findByTestId('share-card-share')
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
  return { image, button }
}
// The options each focus() call on one element received, in call order.
const focusOptions = (
  focus: MockInstance<(options?: FocusOptions) => void>,
  element: Element
) =>
  focus.mock.contexts.flatMap((context, index) =>
    context === element ? [focus.mock.calls[index]?.[0]] : []
  )
const shareEvents = (capture: { mock: { calls: unknown[][] } }) =>
  capture.mock.calls.filter(([event]) => event === 'share_card_shared').map(([, p]) => p)
/** Lets a chain of already-settled promise continuations run to its end. */
async function flushMicrotasks() {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
}
/**
 * Records the body read the dialog makes on a refused share prepare's cloned 403
 * response (`shareDisabledRefusal`), so a test can await the refusal decision.
 */
function refusalBodyReads() {
  const reads: Promise<unknown>[] = []
  // Called below with the spied response as `this`.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const clone = Response.prototype.clone
  vi.spyOn(Response.prototype, 'clone').mockImplementation(function (this: Response) {
    const copy = clone.call(this)
    if (this.status === 403) {
      const json = copy.json.bind(copy)
      copy.json = () => {
        const read = json()
        reads.push(read.catch(() => undefined))
        return read
      }
    }
    return copy
  })
  return reads
}
describe('C-WEB-SHARE-DIALOG: Web Share beside Download', () => {
  let capture: MockInstance<typeof browserAnalytics.capture>
  beforeEach(() => {
    canShare.mockReset().mockReturnValue(true)
    webShare.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare })
    Object.defineProperty(navigator, 'share', { configurable: true, value: webShare })
    capture = vi.spyOn(browserAnalytics, 'capture').mockImplementation(() => undefined)
    useShareHandlers()
  })
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'canShare')
    Reflect.deleteProperty(navigator, 'share')
    vi.useRealTimers()
  })
  it('C-WEB-SHARE-DIALOG IO8: Share needs the member capability and canShare; unsupported never asks', async () => {
    const asked = useShareHandlers()
    const image = await open()
    const button = await screen.findByTestId('share-card-share')
    expect(button).toBeDisabled()
    fireEvent.load(image)
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
    expect(button).toHaveAccessibleName(enUS.shareCard.share)
    expect(asked).toEqual(['member-one'])
    expect(canShare.mock.calls[0]![0].files[0]).toMatchObject({
      name: 'couturecast-card.png',
      type: 'image/png',
    })
    cleanup()
    canShare.mockReturnValue(false)
    const unsupported = useShareHandlers()
    render(<ShareCardControl source={source} />)
    await userEvent.click(screen.getByTestId('share-card-open'))
    fireEvent.load(await screen.findByTestId('share-card-preview'))
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    expect(unsupported).toEqual([])
    expect(webShare).not.toHaveBeenCalled()
    expect(shareEvents(capture)).toEqual([])
  })
  it.each([
    ['off', () => HttpResponse.json({ data: { nativeShare: false } })],
    ['404', () => HttpResponse.json({ code: 'not_found' }, { status: 404 })],
    ['malformed', () => HttpResponse.json({ data: { nativeShare: 'yes' } })],
    ['missing', () => HttpResponse.json({ nativeShare: true })],
    ['pending', () => new Promise<Response>(() => undefined)],
  ] as const)(
    'C-WEB-SHARE-DIALOG IO8: a capability that is %s leaves Download alone',
    async (state, capability) => {
      // A pending read settles at the client's 5 s deadline; only the clock is faked.
      if (state === 'pending')
        vi.useFakeTimers({
          shouldAdvanceTime: true,
          toFake: ['setTimeout', 'clearTimeout'],
        })
      const requested = useShareHandlers(approved, capability)
      const image = await open()
      fireEvent.load(image)
      await waitFor(() => expect(requested).toHaveLength(1))
      if (state === 'pending')
        act(() => {
          vi.advanceTimersByTime(SHARE_CARD_CAPABILITIES_DEADLINE_MS)
        })
      // The dialog has applied the answer it awaited.
      await settle(settled.capabilities, 0)
      await expect(settled.capabilities[0]).resolves.toEqual({ nativeShare: false })
      expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
      expect(screen.getByTestId('share-card-save')).toBeEnabled()
      expect(shareEvents(capture)).toEqual([])
    }
  )
  it('C-WEB-SHARE-DIALOG IO10: identity change clears capability and authorization, and each new member asks again', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const asked = useShareHandlers(approved, async () => {
      if (identity.member === 'member-two') {
        await held
        return HttpResponse.json({ data: { nativeShare: true } })
      }
      return HttpResponse.json({ data: { nativeShare: true } })
    })
    const { button } = await openWithShare()
    webShare.mockImplementationOnce(() => shareError('NotAllowedError'))
    fireEvent.click(button)
    await screen.findByText(enUS.shareCard.shareTapAgain, { selector: '[role="status"]' })
    act(() => {
      identity.member = 'member-two'
      window.dispatchEvent(new Event('couture:session'))
    })
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    await waitFor(() => expect(asked).toEqual(['member-one', 'member-two']))
    act(() => {
      identity.member = 'member-three'
      window.dispatchEvent(new Event('couture:session'))
    })
    await act(async () => {
      release()
      await held
    })
    await waitFor(() =>
      expect(asked).toEqual(['member-one', 'member-two', 'member-three'])
    )
    const fresh = await screen.findByTestId('share-card-preview')
    fireEvent.load(fresh)
    const again = await screen.findByTestId('share-card-share')
    await waitFor(() => expect(again).not.toHaveAttribute('aria-disabled'))
    fireEvent.click(again)
    // The former member's authorization is gone: a new share prepare runs first.
    await waitFor(() => expect(webShare).toHaveBeenCalledTimes(2))
    expect(
      requests.filter((body) => (body as { purpose: string }).purpose === 'share')
    ).toHaveLength(2)
  })
  it('C-WEB-SHARE-DIALOG IO3 AC1: resolve hands off the reauthorized previewed bytes, says sentToApp once, focuses Share and captures one event', async () => {
    const { image, button } = await openWithShare()
    await userEvent.click(button)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.sentToApp)
    )
    expect(requests).toEqual([
      expect.objectContaining({ purpose: 'preview' }),
      {
        source,
        locale: 'en-US',
        watermark: true,
        purpose: 'share',
        expectedSha256: preparedShareCardFixture.sha256,
      },
    ])
    const { files } = webShare.mock.calls[0]![0]
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('couturecast-card.png')
    expect(files[0]!.type).toBe('image/png')
    expect(await fileDigest(files[0]!)).toBe(preparedShareCardFixture.sha256)
    expect(button).toHaveFocus()
    expect(screen.getByTestId('share-card-preview')).toBe(image)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(enUS.shareCard.shared)).not.toBeInTheDocument()
    expect(shareEvents(capture)).toEqual([
      {
        client: 'web',
        target: 'unknown',
        outcome: 'handed_off',
        duration_ms: expect.any(Number) as number,
        locale: 'en-US',
      },
    ])
    expect(handoff).not.toHaveBeenCalled()
  })
  it('C-WEB-SHARE-DIALOG IO7 R-007: NotAllowedError keeps the authorization; the next tap calls share synchronously with no new prepare', async () => {
    const { button } = await openWithShare()
    webShare.mockImplementationOnce(() => shareError('NotAllowedError'))
    await userEvent.click(button)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.shareTapAgain)
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(shareEvents(capture)).toEqual([
      {
        client: 'web',
        target: 'none',
        outcome: 'failed',
        duration_ms: expect.any(Number) as number,
        locale: 'en-US',
      },
    ])
    const first = webShare.mock.calls[0]![0].files[0]
    fireEvent.click(button)
    // No await between the tap and share(): the call has already happened.
    expect(webShare).toHaveBeenCalledTimes(2)
    expect(webShare.mock.calls[1]![0].files[0]).toBe(first)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.sentToApp)
    )
    expect(requests.map((body) => (body as { purpose: string }).purpose)).toEqual([
      'preview',
      'share',
    ])
    expect(shareEvents(capture)).toHaveLength(2)
    expect(shareEvents(capture)[1]).toMatchObject({ outcome: 'handed_off' })
  })
  it.each([
    ['handed_off', () => Promise.resolve(), enUS.shareCard.sentToApp],
    ['dismissed', () => shareError('AbortError'), enUS.shareCard.shareClosed],
  ] as const)(
    'C-WEB-SHARE-DIALOG R-007: a %s result ends the authorization, so the next tap prepares again',
    async (_, result, note) => {
      const { button } = await openWithShare()
      webShare.mockImplementationOnce(result)
      await userEvent.click(button)
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(note))
      await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
      fireEvent.click(button)
      // No held File: the tap waits on a fresh share prepare before share().
      expect(webShare).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(webShare).toHaveBeenCalledTimes(2))
      expect(requests.map((body) => (body as { purpose: string }).purpose)).toEqual([
        'preview',
        'share',
        'share',
      ])
    }
  )
  it('C-WEB-SHARE-DIALOG R-007: the authorization expires at 60 s, then a tap reauthorizes', async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout', 'Date'],
    })
    const { button } = await openWithShare()
    webShare.mockImplementation(() => shareError('NotAllowedError'))
    fireEvent.click(button)
    await waitFor(() => expect(webShare).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
    act(() => {
      vi.advanceTimersByTime(SHARE_AUTHORIZATION_TTL_MS - 1000)
    })
    fireEvent.click(button)
    expect(webShare).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(button)
    expect(webShare).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(webShare).toHaveBeenCalledTimes(3))
    expect(
      requests.filter((body) => (body as { purpose: string }).purpose === 'share')
    ).toHaveLength(2)
  })
  it.each(['close', 'composition'] as const)(
    'C-WEB-SHARE-DIALOG R-007: %s clears the authorization',
    async (change) => {
      const { button } = await openWithShare()
      webShare.mockImplementationOnce(() => shareError('NotAllowedError'))
      fireEvent.click(button)
      await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
      if (change === 'close') {
        await userEvent.keyboard('{Escape}')
        await userEvent.click(screen.getByTestId('share-card-open'))
        fireEvent.load(await screen.findByTestId('share-card-preview'))
      } else {
        useMswHandlers(
          http.post(endpoint, async ({ request }) => {
            const body = (await request.json()) as { purpose: string; watermark: boolean }
            requests.push(body)
            if (body.purpose !== 'preview') return approved()
            const accessibilityLabel = body.watermark ? 'ON card' : 'OFF card'
            return HttpResponse.json({
              data: { ...preparedShareCardFixture, accessibilityLabel },
            })
          })
        )
        const toggle = screen.getByRole('checkbox', { name: enUS.shareCard.watermark })
        for (const name of ['OFF card', 'ON card']) {
          await userEvent.click(toggle)
          fireEvent.load(await screen.findByRole('img', { name }))
        }
      }
      const again = screen.getByTestId('share-card-share')
      await waitFor(() => expect(again).not.toHaveAttribute('aria-disabled'))
      fireEvent.click(again)
      expect(webShare).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(webShare).toHaveBeenCalledTimes(2))
      expect(
        requests.filter((body) => (body as { purpose: string }).purpose === 'share')
      ).toHaveLength(2)
    }
  )
  it('C-WEB-SHARE-DIALOG IO4 AC2: AbortError says shareClosed, keeps the preview and focuses Share', async () => {
    const { image, button } = await openWithShare()
    webShare.mockImplementationOnce(() => shareError('AbortError'))
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    await userEvent.click(button)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.shareClosed)
    )
    expect(button).toHaveFocus()
    // Nothing moves on this path, so the focus return never scrolls the dialog.
    expect(focusOptions(focus, button).at(-1)).toEqual({ preventScroll: true })
    expect(screen.getByTestId('share-card-preview')).toBe(image)
    expect(screen.getByRole('checkbox', { name: enUS.shareCard.watermark })).toBeChecked()
    expect(screen.getByTestId('share-card-save')).toBeEnabled()
    expect(shareEvents(capture)).toEqual([
      {
        client: 'web',
        target: 'none',
        outcome: 'dismissed',
        duration_ms: expect.any(Number) as number,
        locale: 'en-US',
      },
    ])
  })
  it.each([
    ['a share() failure', approved, () => shareError('DataError'), 1],
    [
      'a 403',
      () => HttpResponse.json({ code: 'share_disabled' }, { status: 403 }),
      undefined,
      0,
    ],
    ['offline', approved, undefined, 0],
  ] as const)(
    'C-WEB-SHARE-DIALOG IO5: %s shows merlot shareFailed, focuses Download and keeps the preview',
    async (name, respond, rejection, handoffs) => {
      useShareHandlers(respond)
      const { image, button } = await openWithShare()
      if (rejection) webShare.mockImplementationOnce(rejection)
      if (name === 'offline')
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      const focus = vi.spyOn(HTMLElement.prototype, 'focus')
      await userEvent.click(button)
      expect(await screen.findByRole('alert')).toHaveTextContent(
        enUS.shareCard.shareFailed
      )
      expect(screen.getByTestId('share-card-save')).toHaveFocus()
      // The alert grows the dialog, so the focus move may scroll Download into view.
      expect(focusOptions(focus, screen.getByTestId('share-card-save'))).toEqual([
        { preventScroll: false },
      ])
      expect(screen.getByTestId('share-card-save')).toBeEnabled()
      expect(screen.getByTestId('share-card-preview')).toBe(image)
      expect(webShare).toHaveBeenCalledTimes(handoffs)
      expect(shareEvents(capture)).toEqual([
        {
          client: 'web',
          target: 'none',
          outcome: 'failed',
          duration_ms: expect.any(Number) as number,
          locale: 'en-US',
        },
      ])
    }
  )
  it('C-WEB-SHARE-DIALOG V13: a share_disabled 403 hides Share for the member and the next open reads the capability again', async () => {
    const asked = useShareHandlers(() =>
      HttpResponse.json({ code: 'share_disabled' }, { status: 403 })
    )
    const { button } = await openWithShare()
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent(enUS.shareCard.shareFailed)
    await waitFor(() =>
      expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('share-card-save')).toBeEnabled()
    expect(asked).toEqual(['member-one'])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByTestId('share-card-open'))
    fireEvent.load(await screen.findByTestId('share-card-preview'))
    await waitFor(() => expect(asked).toEqual(['member-one', 'member-one']))
    expect(await screen.findByTestId('share-card-share')).toBeInTheDocument()
  })
  it('C-WEB-SHARE-DIALOG V13: a 403 that does not name share_disabled keeps Share', async () => {
    useShareHandlers(() => HttpResponse.json({ code: 'forbidden' }, { status: 403 }))
    const bodyReads = refusalBodyReads()
    const { button } = await openWithShare()
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent(enUS.shareCard.shareFailed)
    // The dialog has read the refused body and decided it does not name share_disabled.
    await waitFor(() => expect(bodyReads).toHaveLength(1))
    await act(async () => {
      await bodyReads[0]
      await flushMicrotasks()
    })
    expect(screen.getByTestId('share-card-share')).toBeInTheDocument()
  })
  it('C-WEB-SHARE-DIALOG IO6: a 409 takes the 6.8 stale path with focus on Refresh and both actions held', async () => {
    useShareHandlers(() =>
      HttpResponse.json({ code: 'preview_changed' }, { status: 409 })
    )
    const { image, button } = await openWithShare()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      enUS.shareCard.previewChanged
    )
    const refresh = screen.getByRole('button', { name: enUS.shareCard.refresh })
    await waitFor(() => expect(refresh).toHaveFocus())
    // WCAG 2.4.11: the alert and the new Refresh line grow the dialog, so the focus
    // move may scroll Refresh into the panel's visible area.
    expect(focusOptions(focus, refresh)).toEqual([{ preventScroll: false }])
    expect(screen.getByTestId('share-card-preview')).toBe(image)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('share-card-save')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    fireEvent.click(screen.getByTestId('share-card-save'))
    expect(webShare).not.toHaveBeenCalled()
    expect(shareEvents(capture)).toEqual([
      {
        client: 'web',
        target: 'none',
        outcome: 'failed',
        duration_ms: expect.any(Number) as number,
        locale: 'en-US',
      },
    ])
    await userEvent.click(refresh)
    await waitFor(() => expect(screen.getByTestId('share-card-preview')).not.toBe(image))
    fireEvent.load(screen.getByTestId('share-card-preview'))
    await waitFor(() =>
      expect(screen.getByTestId('share-card-share')).not.toHaveAttribute('aria-disabled')
    )
  })
  it('C-WEB-SHARE-DIALOG V14: a 409 after a sign-out the dialog has not seen yet emits no event', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    useShareHandlers(async () => {
      await held
      return HttpResponse.json({ code: 'preview_changed' }, { status: 409 })
    })
    const { button } = await openWithShare()
    fireEvent.click(button)
    await waitFor(() => expect(requests).toHaveLength(2))
    // The live session changes before any couture:session event re-renders the dialog.
    identity.member = null
    act(() => release())
    // The dialog's catch for the refused share prepare has run.
    await settle(settled.authorizations, 0)
    await expect(settled.authorizations[0]).rejects.toMatchObject({
      response: { status: 409 },
    })
    expect(shareEvents(capture)).toEqual([])
    expect(screen.queryByText(enUS.shareCard.previewChanged)).not.toBeInTheDocument()
  })
  it('C-WEB-SHARE-DIALOG AC3: duplicate taps during a pending attempt make one attempt and one event', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    useShareHandlers(async () => {
      await held
      return approved()
    })
    const { button } = await openWithShare()
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(screen.getByTestId('share-card-save'))
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.sharing)
    expect(shareEvents(capture)).toEqual([])
    await act(async () => {
      release()
      await held
    })
    await waitFor(() => expect(webShare).toHaveBeenCalledOnce())
    await waitFor(() => expect(shareEvents(capture)).toHaveLength(1))
    expect(requests).toHaveLength(2)
    expect(handoff).not.toHaveBeenCalled()
  })
  it('C-WEB-SHARE-DIALOG IO10: an attempt superseded by an identity change emits no event and no feedback', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { button } = await openWithShare()
    // The sheet is still open when the member signs out.
    webShare.mockImplementationOnce(() => held)
    fireEvent.click(button)
    await waitFor(() => expect(webShare).toHaveBeenCalledOnce())
    act(() => {
      identity.member = null
      window.dispatchEvent(new Event('couture:session'))
    })
    expect(screen.queryByTestId('share-card-preview')).not.toBeInTheDocument()
    act(() => release())
    // The handoff the dialog awaited has settled, so its settle step has run.
    await settle(settled.handoffs, 0)
    await expect(settled.handoffs[0]).resolves.toMatchObject({ outcome: 'handed_off' })
    expect(shareEvents(capture)).toEqual([])
    expect(screen.queryByText(enUS.shareCard.sentToApp)).not.toBeInTheDocument()
  })
  it.each(['close', 'composition'] as const)(
    'C-WEB-SHARE-DIALOG IO10: a %s during the share prepare settles one failed event with no feedback and no handoff',
    async (change) => {
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      useShareHandlers(async () => {
        await held
        return approved()
      })
      const { image, button } = await openWithShare()
      fireEvent.click(button)
      await waitFor(() => expect(requests).toHaveLength(2))
      if (change === 'close') await userEvent.keyboard('{Escape}')
      else
        await act(async () => {
          await currentI18n().changeLanguage('fr-FR')
        })
      act(() => release())
      // The aborted share prepare has settled and the dialog has run its catch.
      await settle(settled.authorizations, 0)
      expect(webShare).not.toHaveBeenCalled()
      expect(settled.handoffs).toEqual([])
      expect(shareEvents(capture)).toEqual([
        {
          client: 'web',
          target: 'none',
          outcome: 'failed',
          duration_ms: expect.any(Number) as number,
          locale: change === 'close' ? 'en-US' : 'fr-FR',
        },
      ])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText(enUS.shareCard.sentToApp)).not.toBeInTheDocument()
      if (change === 'composition') {
        // The replacement preview loads and Share is ready again for a new attempt.
        await waitFor(() =>
          expect(screen.getByTestId('share-card-preview')).not.toBe(image)
        )
        fireEvent.load(screen.getByTestId('share-card-preview'))
        await waitFor(() =>
          expect(screen.getByTestId('share-card-share')).not.toHaveAttribute(
            'aria-disabled'
          )
        )
      }
    }
  )
  it('C-WEB-SHARE-DIALOG R-007: a new presentation of the same composition ends the authorization', async () => {
    const { image, button } = await openWithShare()
    webShare.mockImplementationOnce(() => shareError('NotAllowedError'))
    fireEvent.click(button)
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
    // A render failure and Retry load the same composition as a new presentation.
    fireEvent.error(image)
    await userEvent.click(await screen.findByTestId('share-card-recovery'))
    await waitFor(() => expect(screen.getByTestId('share-card-preview')).not.toBe(image))
    fireEvent.load(screen.getByTestId('share-card-preview'))
    const again = screen.getByTestId('share-card-share')
    await waitFor(() => expect(again).not.toHaveAttribute('aria-disabled'))
    fireEvent.click(again)
    // No synchronous handoff with the former presentation's File: it reauthorizes first.
    expect(webShare).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(webShare).toHaveBeenCalledTimes(2))
    expect(
      requests.filter((body) => (body as { purpose: string }).purpose === 'share')
    ).toHaveLength(2)
  })
  it('C-WEB-SHARE-DIALOG IO11: a capture that throws or rejects never changes the outcome', async () => {
    const { button } = await openWithShare()
    capture.mockImplementationOnce(() => {
      throw new Error('analytics_down')
    })
    await userEvent.click(button)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.sentToApp)
    )
    expect(button).toHaveFocus()
    // A spy subscribes to every promise its implementation returns, so an unhandled
    // rejection could never surface here; the dialog's own catch is what is observed.
    let caught = 0
    capture.mockImplementationOnce(() => {
      const rejected = Promise.reject(new Error('analytics_rejected'))
      const handle = rejected.catch.bind(rejected)
      rejected.catch = (onRejected) => {
        caught += 1
        return handle(onRejected)
      }
      return rejected as unknown as void
    })
    webShare.mockImplementationOnce(() => shareError('AbortError'))
    await userEvent.click(button)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.shareClosed)
    )
    expect(button).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(shareEvents(capture)).toHaveLength(2)
    expect(caught).toBe(1)
  })
  it('C-WEB-SHARE-DIALOG IO10: a late capability answer for the previous member never shows Share to the next', async () => {
    let answerMemberTwo!: (value: { nativeShare: boolean }) => void
    // Member two's answer is held and says on; member three's says off. The stand-in
    // ignores the abort, as a transport that never honors its signal would.
    settled.capabilityRead = (_signal) =>
      identity.member === 'member-two'
        ? new Promise((resolve) => {
            answerMemberTwo = resolve
          })
        : Promise.resolve({ nativeShare: identity.member === 'member-one' })
    await openWithShare()
    act(() => {
      identity.member = 'member-two'
      window.dispatchEvent(new Event('couture:session'))
    })
    await waitFor(() => expect(settled.capabilities).toHaveLength(2))
    act(() => {
      identity.member = 'member-three'
      window.dispatchEvent(new Event('couture:session'))
    })
    await settle(settled.capabilities, 2)
    await expect(settled.capabilities[2]).resolves.toEqual({ nativeShare: false })
    // Member two's on arrives last, after member three's own off.
    act(() => answerMemberTwo({ nativeShare: true }))
    await settle(settled.capabilities, 1)
    fireEvent.load(await screen.findByTestId('share-card-preview'))
    await waitFor(() => expect(screen.getByTestId('share-card-save')).toBeEnabled())
    expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
  })
  it('C-WEB-SHARE-DIALOG IO10: an identity change during the share prepare hands off nothing and emits no event', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    useShareHandlers(async () => {
      await held
      return approved()
    })
    const { button } = await openWithShare()
    fireEvent.click(button)
    await waitFor(() => expect(requests).toHaveLength(2))
    act(() => {
      identity.member = 'member-two'
      window.dispatchEvent(new Event('couture:session'))
    })
    act(() => release())
    // The share prepare has settled and the dialog has run its catch.
    await settle(settled.authorizations, 0)
    expect(webShare).not.toHaveBeenCalled()
    expect(settled.handoffs).toEqual([])
    expect(shareEvents(capture)).toEqual([])
    expect(screen.queryByText(enUS.shareCard.sentToApp)).not.toBeInTheDocument()
  })
  it.each(['close', 'composition'] as const)(
    'C-WEB-SHARE-DIALOG R2 IO4 AC3: a %s while the sheet is open keeps handed_off, with no feedback and no alert',
    async (change) => {
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const { button } = await openWithShare()
      webShare.mockImplementationOnce(() => held)
      fireEvent.click(button)
      await waitFor(() => expect(webShare).toHaveBeenCalledOnce())
      // The watermark toggle is disabled while a share runs; a locale change is the
      // composition change a member can still make.
      if (change === 'close') await userEvent.keyboard('{Escape}')
      else
        await act(async () => {
          await currentI18n().changeLanguage('fr-FR')
        })
      act(() => release())
      await settle(settled.handoffs, 0)
      expect(shareEvents(capture)).toEqual([
        {
          client: 'web',
          target: 'unknown',
          outcome: 'handed_off',
          duration_ms: expect.any(Number) as number,
          locale: change === 'close' ? 'en-US' : 'fr-FR',
        },
      ])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText(enUS.shareCard.sentToApp)).not.toBeInTheDocument()
      if (change === 'composition') {
        // The dialog stays open in French: no outcome copy in any language.
        expect(screen.getByTestId('share-card-feedback')).toBeEmptyDOMElement()
        expect(screen.getByRole('status')).not.toHaveTextContent(frFR.shareCard.sentToApp)
      } else {
        await userEvent.click(screen.getByTestId('share-card-open'))
        expect(await screen.findByTestId('share-card-preview')).toBeInTheDocument()
        expect(screen.getByRole('status')).not.toHaveTextContent(enUS.shareCard.sentToApp)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      }
    }
  )
  it('C-WEB-SHARE-DIALOG R-007: past 60 s by the clock while a throttled timer has not fired, a tap reauthorizes', async () => {
    // Only Date is faked: the expiry timer stays real and cannot fire within the test.
    vi.useFakeTimers({ toFake: ['Date'] })
    const { button } = await openWithShare()
    webShare.mockImplementationOnce(() => shareError('NotAllowedError'))
    fireEvent.click(button)
    await waitFor(() => expect(webShare).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
    vi.setSystemTime(Date.now() + SHARE_AUTHORIZATION_TTL_MS)
    fireEvent.click(button)
    // The held File is not handed off synchronously: the deadline check cleared it.
    expect(webShare).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(webShare).toHaveBeenCalledTimes(2))
    expect(
      requests.filter((body) => (body as { purpose: string }).purpose === 'share')
    ).toHaveLength(2)
  })
  it('C-WEB-SHARE-LAYOUT: one hidden feedback slot holds its place while outcome copy appears and clears', async () => {
    // jsdom has no layout: the slot keeps one line (min-h-5 = text-sm's 20 px) and is the
    // same element in every state, so single-line copy never resizes the dialog.
    const { button } = await openWithShare()
    const slot = screen.getByTestId('share-card-feedback')
    expect(slot).toHaveAttribute('aria-hidden', 'true')
    expect(slot).toHaveClass('min-h-5', 'text-sm')
    expect(slot).toBeEmptyDOMElement()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    await userEvent.click(button)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.sentToApp)
    )
    expect(screen.getByTestId('share-card-feedback')).toBe(slot)
    expect(slot).toHaveTextContent(enUS.shareCard.sentToApp)
    expect(slot).toHaveAttribute('aria-hidden', 'true')
    // Assistive technology reaches the copy once: through the status region alone.
    const exposed = screen
      .getAllByText(enUS.shareCard.sentToApp)
      .filter((element) => !element.closest('[aria-hidden="true"]'))
    expect(exposed).toEqual([screen.getByRole('status')])
    expect(screen.getAllByRole('status')).toHaveLength(1)
    await userEvent.click(
      screen.getByRole('checkbox', { name: enUS.shareCard.watermark })
    )
    expect(screen.getByTestId('share-card-feedback')).toBe(slot)
    expect(slot).toBeEmptyDOMElement()
  })
  it('C-WEB-SHARE-LAYOUT: Download and Share lead, Refresh then Cancel follow aligned to Download, stacked below sm and on one wrapping row from sm', async () => {
    useShareHandlers(() =>
      HttpResponse.json({ code: 'preview_changed' }, { status: 409 })
    )
    const { button } = await openWithShare()
    const primary = screen.getByTestId('share-card-primary-actions')
    const secondary = screen.getByTestId('share-card-secondary-actions')
    const ids = (row: HTMLElement) =>
      Array.from(row.children).map((child) => child.getAttribute('data-testid'))
    expect(ids(primary)).toEqual(['share-card-save', 'share-card-share'])
    expect(ids(secondary)).toEqual(['share-card-cancel'])
    await userEvent.click(button)
    await screen.findByRole('button', { name: enUS.shareCard.refresh })
    expect(ids(primary)).toEqual(['share-card-save', 'share-card-share'])
    expect(ids(secondary)).toEqual(['share-card-recovery', 'share-card-cancel'])
    // jsdom has no layout: the playwright lane measures the rows at desktop sizes. The
    // groups stack below sm and share one wrapping row from sm, in DOM and tab order.
    const actions = primary.parentElement!
    expect(Array.from(actions.children)).toEqual([primary, secondary])
    expect(actions).toHaveClass('flex-col', 'gap-x-6', 'sm:flex-row', 'sm:flex-wrap')
    // The group's negative margin equals the text buttons' padding, so the first label
    // starts on Download's left edge on every line the group starts.
    expect(secondary).toHaveClass('-ml-3', 'flex-wrap')
    for (const action of Array.from(secondary.children))
      expect(action).toHaveClass('px-3')
    for (const action of [...primary.children, ...secondary.children])
      expect(action).toHaveClass('min-h-[44px]')
    expect(screen.getByTestId('share-card-cancel')).toHaveAccessibleName(
      enUS.shareCard.cancel
    )
    // The preview's cap leaves the rest of the dialog its 22rem at short viewports. In
    // the column surface the stale alert and a wrapped Refresh row take their height
    // from the preview, which may shrink to 12rem.
    const preview = screen.getByTestId('share-card-preview')
    expect(preview).toHaveClass(
      'max-h-[min(55dvh,calc(100dvh-22rem))]',
      'min-h-[min(12rem,55dvh,calc(100dvh-22rem))]'
    )
    expect(screen.getByRole('dialog').firstElementChild).toHaveClass('flex', 'flex-col')
    expect(preview.parentElement).toBe(screen.getByRole('dialog').firstElementChild)
  })
})
