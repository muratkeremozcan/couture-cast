// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { currentI18n } from '../../i18n'
import enUS from '../../i18n/locales/en-US.json'
import { ShareCardControl } from './share-card-dialog'
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
