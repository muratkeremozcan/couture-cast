import { createHash, webcrypto } from 'node:crypto'
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
import { currentI18n } from '../../i18n'
import enUS from '../../i18n/locales/en-US.json'
import { browserAnalytics } from '../../analytics/browser-analytics'
import { SHARE_AUTHORIZATION_TTL_MS, ShareCardControl } from './share-card-dialog'
const identity = vi.hoisted(() => ({ member: 'member-one' as string | null }))
vi.mock('../../lib/web-session', () => ({ webSessionIdentity: () => identity.member }))
const source = { kind: 'outfit', recommendationId: 'owned-recommendation' } as const
const endpoint = 'http://localhost:3001/api/v1/share-cards/prepare'
const requests: unknown[] = []
const handoff = vi.fn()
beforeEach(async () => {
  identity.member = 'member-one'
  requests.length = 0
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001')
  vi.stubGlobal('crypto', webcrypto)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:approved'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(handoff)
  await currentI18n().changeLanguage('en-US')
  useMswHandlers(handler())
})
async function open(target: Parameters<typeof ShareCardControl>[0]['source'] = source) {
  render(<ShareCardControl source={target} />)
  await userEvent.click(screen.getByTestId('share-card-open'))
  const image = await screen.findByTestId('share-card-preview')
  return image
}
const handler = () =>
  http.post(endpoint, async ({ request }) => {
    requests.push(await request.json())
    return HttpResponse.json({ data: preparedShareCardFixture })
  })
describe('exact-byte share-card dialog', () => {
  it('M5 R2-L2: handoff Retry retains focus while pending, then removes recovery and focuses Save', async () => {
    const image = await open()
    fireEvent.load(image)
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    useMswHandlers(
      http.post(endpoint, async ({ request }) => {
        const body = (await request.json()) as { purpose: string }
        requests.push(body)
        if (requests.length === 3) {
          entered()
          await held
        }
        return HttpResponse.json({ data: preparedShareCardFixture })
      })
    )
    handoff.mockImplementationOnce(() => {
      throw new Error('observable_handoff_failure')
    })
    await userEvent.click(screen.getByTestId('share-card-save'))
    await screen.findByRole('alert')
    const retry = screen.getByRole('button', { name: 'Try again' })
    await userEvent.click(retry)
    await started
    expect(retry).toHaveFocus()
    await act(async () => {
      release()
      await held
    })
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(requests).toEqual([
      expect.objectContaining({ purpose: 'preview' }),
      expect.objectContaining({ purpose: 'save' }),
      expect.objectContaining({ purpose: 'save' }),
    ])
    expect(screen.getByTestId('share-card-preview')).toBe(image)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Download started')
    )
    expect(retry).not.toBeInTheDocument()
    expect(screen.getByTestId('share-card-save')).toHaveFocus()
    expect(handoff).toHaveBeenCalledTimes(2)
  })
  it('M5 R2-L2: conflict keeps Save focus and Refresh retires after its loaded preparation succeeds', async () => {
    const image = await open()
    fireEvent.load(image)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    useMswHandlers(
      http.post(endpoint, async ({ request }) => {
        const body = (await request.json()) as { purpose: string }
        requests.push(body)
        if (body.purpose === 'preview') await held
        return body.purpose === 'save'
          ? HttpResponse.json({ code: 'preview_changed' }, { status: 409 })
          : HttpResponse.json({ data: preparedShareCardFixture })
      })
    )
    const save = screen.getByTestId('share-card-save')
    await userEvent.click(save)
    await screen.findByRole('alert')
    expect(save).toHaveFocus()
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).not.toBeDisabled()
    const refresh = screen.getByRole('button', { name: 'Refresh preview' })
    await userEvent.click(refresh)
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(screen.getByTestId('share-card-preview')).toBe(image)
    expect(refresh).toHaveFocus()
    await act(async () => {
      release()
      await held
    })
    await waitFor(() => expect(screen.getByTestId('share-card-preview')).not.toBe(image))
    expect(screen.getByTestId('share-card-preview')).toHaveAttribute(
      'src',
      image.getAttribute('src')
    )
    expect(refresh).toHaveFocus()
    fireEvent.load(screen.getByTestId('share-card-preview'))
    await waitFor(() => expect(refresh).not.toBeInTheDocument())
    expect(screen.getByTestId('share-card-save')).toHaveFocus()
    expect(handoff).not.toHaveBeenCalled()
  })
  it('M6: closing a recoverable error clears its alert while retaining approved bytes', async () => {
    const image = await open()
    fireEvent.load(image)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await userEvent.click(screen.getByTestId('share-card-save'))
    await screen.findByRole('alert')
    await userEvent.keyboard('{Escape}')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await userEvent.click(screen.getByTestId('share-card-open'))
    expect(await screen.findByTestId('share-card-preview')).toHaveAttribute(
      'src',
      image.getAttribute('src')
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(requests).toHaveLength(1)
  })
  it('U-OFFLINE P-OFFLINE: the same member retries an offline Save and downloads the retained preview', async () => {
    const image = await open()
    fireEvent.load(image)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await userEvent.click(screen.getByTestId('share-card-save'))
    expect(await screen.findByRole('alert')).toHaveTextContent(enUS.shareCard.offline)
    expect(requests).toHaveLength(1)
    expect(handoff).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await userEvent.click(screen.getByRole('button', { name: enUS.shareCard.retry }))
    await waitFor(() => expect(handoff).toHaveBeenCalledOnce())
    expect(requests).toEqual([
      expect.objectContaining({ purpose: 'preview' }),
      expect.objectContaining({
        purpose: 'save',
        expectedSha256: preparedShareCardFixture.sha256,
      }),
    ])
    expect(screen.getByTestId('share-card-preview')).toBe(image)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('Download started')
  })
  it('P-PHOTO-PREVIEW: own-photo export explains that photo content stays visible before the watermark control', async () => {
    await open({ kind: 'community_post', postId: 'own-post' })
    const help = screen.getByText(enUS.shareCard.photoPrivacyHelp, { exact: true })
    const control = screen.getByRole('checkbox', { name: enUS.shareCard.watermark })
    expect(screen.getByRole('dialog')).toContainElement(help)
    expect(
      help.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
  it('P-PHOTO-PREVIEW: an outfit card carries no photo privacy help', async () => {
    await open()
    expect(
      screen.queryByText(enUS.shareCard.photoPrivacyHelp, { exact: true })
    ).not.toBeInTheDocument()
  })
  it('U-WEB-SAVE U-A11Y: image load gates explicit fresh authorization and truthful download handoff', async () => {
    const image = await open()
    const save = screen.getByTestId('share-card-save')
    expect(save).toBeDisabled()
    expect(screen.getByRole('heading', { level: 3 })).toHaveFocus()
    fireEvent.load(image)
    await userEvent.click(save)
    await waitFor(() => expect(handoff).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([
      expect.objectContaining({ purpose: 'preview' }),
      expect.objectContaining({
        purpose: 'save',
        expectedSha256: preparedShareCardFixture.sha256,
      }),
    ])
    expect(await screen.findByRole('status')).toHaveTextContent('Download started')
    expect(save).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('share-card-open')).toHaveFocus()
  })
  it('U-CANCEL: Escape closes without a write and composition survives reopening', async () => {
    const image = await open()
    fireEvent.load(image)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('share-card-preview')).not.toBeInTheDocument()
    expect(handoff).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('share-card-open'))
    expect(await screen.findByTestId('share-card-preview')).toHaveAttribute(
      'src',
      `data:image/png;base64,${preparedShareCardFixture.pngBase64}`
    )
    expect(requests).toHaveLength(1)
    expect(screen.getByTestId('share-card-save')).toBeDisabled()
    fireEvent.load(screen.getByTestId('share-card-preview'))
    expect(screen.getByTestId('share-card-save')).toBeEnabled()
  })
  it('restores focus after a Safari-style click and temporary anchor handoff leave focus on the body', async () => {
    const image = await open()
    fireEvent.load(image)
    handoff.mockImplementationOnce(() => {
      document.body.tabIndex = -1
      document.body.focus()
      expect(document.body).toHaveFocus()
    })
    try {
      // Safari pointer activation can leave the modal title focused.
      fireEvent.click(screen.getByTestId('share-card-save'))
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Download started')
      )
      expect(handoff).toHaveBeenCalledOnce()
      expect(screen.getByTestId('share-card-save')).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(screen.getByTestId('share-card-open')).toHaveFocus()
    } finally {
      document.body.removeAttribute('tabindex')
    }
  })
  it('U-OPTIONS: rapid ON/OFF/ON drops the held OFF response and reloads the original approved image', async () => {
    const image = await open()
    fireEvent.load(image)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let offSignal: AbortSignal | undefined
    useMswHandlers(
      http.post(endpoint, async ({ request }) => {
        const body = (await request.json()) as { watermark: boolean }
        requests.push(body)
        if (!body.watermark) {
          offSignal = request.signal
          await held
        }
        return HttpResponse.json({
          data: { ...preparedShareCardFixture, accessibilityLabel: 'Stale OFF card' },
        })
      })
    )
    const toggle = screen.getByRole('checkbox', { name: 'Show watermark' })
    try {
      await userEvent.click(toggle)
      await waitFor(() => expect(offSignal).toBeDefined())
      await userEvent.click(toggle)
      await waitFor(() => expect(offSignal?.aborted).toBe(true))
    } finally {
      release()
    }
    await act(async () => {
      await held
    })
    const restored = screen.getByTestId('share-card-preview')
    expect(restored).not.toBe(image)
    expect(restored).toHaveAttribute('alt', preparedShareCardFixture.accessibilityLabel)
    expect(screen.queryByRole('img', { name: 'Stale OFF card' })).not.toBeInTheDocument()
    // ON reuses the approved bytes it already holds; only the OFF request was sent.
    expect(requests).toEqual([
      expect.objectContaining({ purpose: 'preview', watermark: true }),
      expect.objectContaining({ purpose: 'preview', watermark: false }),
    ])
    expect(screen.getByTestId('share-card-save')).toBeDisabled()
    fireEvent.load(restored)
    await waitFor(() => expect(screen.getByTestId('share-card-save')).toBeEnabled())
  })
  it('U-OPTIONS U-LOCALES: option changes invalidate Save immediately and prepare new approved bytes', async () => {
    const image = await open()
    fireEvent.load(image)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show watermark' }))
    expect(screen.getByTestId('share-card-save')).toBeDisabled()
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({ watermark: false })
    await act(() => currentI18n().changeLanguage('tr-TR'))
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2]).toMatchObject({ locale: 'tr-TR' })
  })
  it('U-LOCALES P-LOCALE: a preview held across a locale change drops its stale-locale bytes and keeps Save gated', async () => {
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let staleSignal: AbortSignal | undefined
    useMswHandlers(
      http.post(endpoint, async ({ request }) => {
        const body = (await request.json()) as { locale: string }
        requests.push(body)
        if (body.locale === 'en-US') {
          staleSignal = request.signal
          entered()
          await held
        }
        return HttpResponse.json({
          data: {
            ...preparedShareCardFixture,
            accessibilityLabel: `${body.locale} card`,
          },
        })
      })
    )
    render(<ShareCardControl source={source} />)
    await userEvent.click(screen.getByTestId('share-card-open'))
    await started
    let fresh: HTMLElement
    try {
      await act(() => currentI18n().changeLanguage('tr-TR'))
      fresh = await screen.findByRole('img', { name: 'tr-TR card' })
      await waitFor(() => expect(staleSignal?.aborted).toBe(true))
      expect(screen.getByTestId('share-card-save')).toBeDisabled()
    } finally {
      release()
    }
    await act(async () => {
      await held
    })
    expect(screen.queryByRole('img', { name: 'en-US card' })).not.toBeInTheDocument()
    expect(screen.getByTestId('share-card-preview')).toBe(fresh)
    expect(screen.getByTestId('share-card-save')).toBeDisabled()
    expect(requests).toEqual([
      expect.objectContaining({ locale: 'en-US' }),
      expect.objectContaining({ locale: 'tr-TR' }),
    ])
    fireEvent.load(fresh)
    await waitFor(() => expect(screen.getByTestId('share-card-save')).toBeEnabled())
    expect(handoff).not.toHaveBeenCalled()
  })
  it('U-IDENTITY: identity change removes the old visible PNG and drops a late former-member completion', async () => {
    const image = await open()
    fireEvent.load(image)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let formerSignal: AbortSignal | undefined
    useMswHandlers(
      http.post(endpoint, async ({ request }) => {
        requests.push(await request.json())
        if (!formerSignal) {
          formerSignal = request.signal
          await held
          return HttpResponse.json({
            data: { ...preparedShareCardFixture, accessibilityLabel: 'Late former card' },
          })
        }
        return HttpResponse.json({ code: 'unauthorized' }, { status: 401 })
      })
    )
    try {
      await userEvent.click(screen.getByRole('checkbox', { name: 'Show watermark' }))
      await waitFor(() => expect(formerSignal).toBeDefined())
      act(() => {
        identity.member = null
        window.dispatchEvent(new Event('couture:session'))
      })
      expect(screen.queryByTestId('share-card-preview')).not.toBeInTheDocument()
      await waitFor(() => expect(formerSignal?.aborted).toBe(true))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        enUS.shareCard.sourceUnavailable
      )
    } finally {
      release()
    }
    await act(async () => {
      await held
    })
    expect(screen.queryByTestId('share-card-preview')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: 'Late former card' })
    ).not.toBeInTheDocument()
    expect(handoff).not.toHaveBeenCalled()
  })
  it('R2-M2: a mounted outfit dialog aborts its former member request and admits only the new member preview', async () => {
    let release!: () => void
    let entered!: () => void
    let cancelled!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const aborted = new Promise<void>((resolve) => {
      cancelled = resolve
    })
    let oldSignal: AbortSignal | undefined
    let count = 0
    useMswHandlers(
      http.post(endpoint, async ({ request }) => {
        count++
        if (count === 1) {
          oldSignal = request.signal
          request.signal.addEventListener('abort', cancelled, { once: true })
          entered()
          await held
          return HttpResponse.json({
            data: {
              ...preparedShareCardFixture,
              accessibilityLabel: 'Former member outfit',
            },
          })
        }
        return HttpResponse.json({
          data: {
            ...preparedShareCardFixture,
            accessibilityLabel: 'Current member outfit',
          },
        })
      })
    )
    render(<ShareCardControl source={source} />)
    await userEvent.click(screen.getByTestId('share-card-open'))
    await started
    const dialog = screen.getByRole('dialog')
    try {
      act(() => {
        identity.member = 'member-two'
        window.dispatchEvent(new Event('couture:session'))
      })
      expect(screen.getByRole('dialog')).toBe(dialog)
      await waitFor(() => expect(oldSignal?.aborted).toBe(true))
      await aborted
      const image = await screen.findByRole('img', { name: 'Current member outfit' })
      fireEvent.load(image)
      await act(async () => {
        release()
        await held
      })
      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(screen.getByTestId('share-card-preview')).toBe(image)
      expect(
        screen.queryByRole('img', { name: 'Former member outfit' })
      ).not.toBeInTheDocument()
      expect(handoff).not.toHaveBeenCalled()
    } finally {
      release()
    }
  })
  it.each(['close-reopen', 'unmount', 'identity'] as const)(
    'U-CANCEL: %s during fresh authorization cancels handoff and transient feedback',
    async (action) => {
      let release!: () => void
      let entered = false
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let requestSignal: AbortSignal | undefined
      useMswHandlers(
        http.post(endpoint, async ({ request }) => {
          const body = (await request.json()) as { purpose: string }
          if (body.purpose === 'save') {
            entered = true
            requestSignal = request.signal
            await held
          }
          return HttpResponse.json({ data: preparedShareCardFixture })
        })
      )
      const view = render(<ShareCardControl source={source} />)
      await userEvent.click(screen.getByTestId('share-card-open'))
      fireEvent.load(await screen.findByTestId('share-card-preview'))
      await userEvent.click(screen.getByTestId('share-card-save'))
      await waitFor(() => expect(entered).toBe(true))
      if (action === 'unmount') view.unmount()
      else if (action === 'identity') {
        act(() => {
          identity.member = 'another-member'
          window.dispatchEvent(new Event('couture:session'))
        })
        screen.getByRole('heading', { level: 3 }).focus()
      } else {
        await userEvent.keyboard('{Escape}')
        await userEvent.click(screen.getByTestId('share-card-open'))
        expect(await screen.findByTestId('share-card-preview')).toBeInTheDocument()
        expect(screen.queryByText('Saving')).not.toBeInTheDocument()
        expect(screen.getByTestId('share-card-save')).toHaveTextContent('Download PNG')
      }
      expect(requestSignal?.aborted).toBe(true)
      await act(async () => {
        release()
        await held
      })
      expect(handoff).not.toHaveBeenCalled()
      expect(screen.queryByText('Download started')).not.toBeInTheDocument()
      if (action !== 'unmount')
        expect(screen.getByTestId('share-card-save')).not.toHaveFocus()
    }
  )
})

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
    async (_, capability) => {
      const requested = useShareHandlers(approved, capability)
      const image = await open()
      fireEvent.load(image)
      await waitFor(() => expect(requested).toHaveLength(1))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()
      expect(screen.getByTestId('share-card-save')).toBeEnabled()
      expect(shareEvents(capture)).toEqual([])
    }
  )
  it('C-WEB-SHARE-DIALOG IO10: identity change clears capability and authorization and drops a late former-member capability answer', async () => {
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
    // member-two's late answer never shows Share to member-three.
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
    await act(async () => {
      release()
      await held
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
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
      await act(async () => {
        release()
        await held
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(webShare).not.toHaveBeenCalled()
      // The aborted prepare settles on its own schedule, which a loaded run can push
      // past the fixed wait above.
      await waitFor(() =>
        expect(shareEvents(capture)).toEqual([
          {
            client: 'web',
            target: 'none',
            outcome: 'failed',
            duration_ms: expect.any(Number) as number,
            locale: change === 'close' ? 'en-US' : 'fr-FR',
          },
        ])
      )
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
    capture.mockImplementationOnce(
      () => Promise.reject(new Error('analytics_rejected')) as unknown as void
    )
    webShare.mockImplementationOnce(() => shareError('AbortError'))
    await userEvent.click(button)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.shareClosed)
    )
    expect(button).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(shareEvents(capture)).toHaveLength(2)
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
