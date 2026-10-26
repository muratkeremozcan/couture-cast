import { webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { currentI18n } from '../../i18n'
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
async function open() {
  render(<ShareCardControl source={source} />)
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
  it('reloads the final cached image after rapid ON/OFF/ON and equal-byte responses', async () => {
    const image = await open()
    fireEvent.load(image)
    const toggle = screen.getByRole('checkbox', { name: 'Show watermark' })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    const restored = screen.getByTestId('share-card-preview')
    expect(restored).not.toBe(image)
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
  it('U-IDENTITY: identity change removes old visible PNG and late member completion', async () => {
    await open()
    act(() => {
      identity.member = null
      window.dispatchEvent(new Event('couture:session'))
    })
    expect(screen.queryByTestId('share-card-preview')).not.toBeInTheDocument()
    expect(handoff).not.toHaveBeenCalled()
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
