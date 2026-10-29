import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { getI18n } from '../../i18n'
const session = vi.hoisted(() => ({
  owner: 'member-a' as string | null,
  token: vi.fn(),
  logout: vi.fn(),
}))
vi.mock('../../lib/web-session', () => ({
  webSessionIdentity: () => session.owner,
  hasStoredWebSession: () => false,
  resolveWebSessionToken: session.token,
  signOutWebSession: session.logout,
}))
import NotificationSettingsPage from './page'
const endpoint = '*/api/v1/community/notification-preferences'
const label = (key: string) => getI18n().t(`community.notifications.${key}`)
const settings = () => ({
  enabled: false,
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'Europe/London',
  timezoneConfigured: true,
  revision: 'r1',
})
function identify(owner: string | null) {
  act(() => {
    session.owner = owner
    window.dispatchEvent(new Event('couture:session'))
  })
}
function gate<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { release, promise }
}
beforeEach(async () => {
  session.owner = 'member-a'
  session.token.mockImplementation(() =>
    Promise.resolve(session.owner ? `signed-${session.owner}` : undefined)
  )
  session.logout.mockResolvedValue(undefined)
  await getI18n().changeLanguage('en-US')
})
describe('notification policy failures and ownership', () => {
  it('saves changed quiet hours and timezone, then avoids a second no-op PATCH', async () => {
    const writes: unknown[] = []
    useMswHandlers(
      http.get(endpoint, () => HttpResponse.json({ data: settings() })),
      http.patch(endpoint, async ({ request }) => {
        const changes = (await request.json()) as Record<string, unknown>
        writes.push(changes)
        const saved = { ...changes }
        delete saved.baseRevision
        return HttpResponse.json({ data: { ...settings(), ...saved, revision: 'r2' } })
      })
    )
    render(<NotificationSettingsPage />)
    await screen.findByDisplayValue('Europe/London')
    fireEvent.click(screen.getByLabelText(label('quiet')))
    fireEvent.change(screen.getByLabelText(label('start')), {
      target: { value: '21:30' },
    })
    fireEvent.change(screen.getByLabelText(label('end')), { target: { value: '08:30' } })
    fireEvent.change(screen.getByLabelText(label('timezone')), {
      target: { value: 'Europe/Paris' },
    })
    fireEvent.click(screen.getByRole('button', { name: label('save') }))
    await screen.findByText(label('saved'))
    expect(writes).toEqual([
      {
        baseRevision: 'r1',
        quietHoursEnabled: true,
        quietHoursStart: '21:30',
        quietHoursEnd: '08:30',
        timezone: 'Europe/Paris',
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: label('save') }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label('save') })).toBeEnabled()
    )
    expect(writes).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: label('signout') }))
    await waitFor(() => expect(session.logout).toHaveBeenCalledOnce())
  })
  it.each([403, 503])(
    'retains a permitted draft after HTTP %s and retries successfully',
    async (status) => {
      let attempts = 0
      useMswHandlers(
        http.get(endpoint, () => HttpResponse.json({ data: settings() })),
        http.patch(endpoint, () =>
          ++attempts === 1
            ? HttpResponse.json({ message: 'unavailable' }, { status })
            : HttpResponse.json({
                data: { ...settings(), enabled: true, revision: 'r2' },
              })
        )
      )
      render(<NotificationSettingsPage />)
      await screen.findByRole('button', { name: label('save') })
      fireEvent.click(screen.getByLabelText(label('enabled')))
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
      await screen.findByText(label('failed'))
      expect(screen.getByLabelText(label('enabled'))).toBeChecked()
      expect(screen.getByRole('button', { name: label('save') })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
      await screen.findByText(label('saved'))
      expect(attempts).toBe(2)
    }
  )
  it('retains edits when conflict recovery itself is unavailable', async () => {
    let reads = 0
    useMswHandlers(
      http.get(endpoint, () =>
        ++reads === 1
          ? HttpResponse.json({ data: settings() })
          : HttpResponse.json({}, { status: 503 })
      ),
      http.patch(endpoint, () =>
        HttpResponse.json({ code: 'revision_conflict' }, { status: 409 })
      )
    )
    render(<NotificationSettingsPage />)
    await screen.findByRole('button', { name: label('save') })
    fireEvent.click(screen.getByLabelText(label('enabled')))
    fireEvent.click(screen.getByRole('button', { name: label('save') }))
    await screen.findByText(label('failed'))
    expect(screen.getByLabelText(label('enabled'))).toBeChecked()
    expect(reads).toBe(2)
    expect(screen.getByRole('button', { name: label('save') })).toBeEnabled()
  })
  it('contains initial read failure and recovers on a verified account change', async () => {
    useMswHandlers(
      http.get(endpoint, ({ request }) =>
        request.headers.get('authorization') === 'Bearer signed-member-a'
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json({ data: settings() })
      )
    )
    render(<NotificationSettingsPage />)
    await screen.findByText(label('failed'))
    expect(screen.queryByLabelText(label('enabled'))).toBeNull()
    identify('member-b')
    await screen.findByRole('button', { name: label('save') })
    expect(screen.queryByText(label('failed'))).toBeNull()
  })
  it('ignores a token arriving after identity loss or unmount', async () => {
    const token = gate<string>()
    session.token.mockReturnValue(token.promise)
    const reads = vi.fn()
    useMswHandlers(
      http.get(endpoint, () => {
        reads()
        return HttpResponse.json({ data: settings() })
      })
    )
    const view = render(<NotificationSettingsPage />)
    identify(null)
    view.unmount()
    await act(async () => {
      token.release('late-token')
      await token.promise
    })
    expect(reads).not.toHaveBeenCalled()
  })
  it('does not resurrect old preferences when a held read finishes after account switch', async () => {
    const response = gate<void>()
    const started = vi.fn()
    useMswHandlers(
      http.get(endpoint, async ({ request }) => {
        if (request.headers.get('authorization') === 'Bearer signed-member-a') {
          started()
          await response.promise
          return HttpResponse.json({ data: settings() })
        }
        return HttpResponse.json({ data: { ...settings(), timezone: 'Europe/Paris' } })
      })
    )
    render(<NotificationSettingsPage />)
    await waitFor(() => expect(started).toHaveBeenCalledOnce())
    identify('member-b')
    await screen.findByDisplayValue('Europe/Paris')
    await act(async () => {
      response.release()
      await response.promise
    })
    expect(screen.queryByDisplayValue('Europe/London')).toBeNull()
    expect(screen.getByLabelText(label('timezone'))).toHaveValue('Europe/Paris')
  })
  it.each([200, 503])(
    'discards an old account save finishing with HTTP %s',
    async (status) => {
      const response = gate<void>()
      const started = vi.fn()
      useMswHandlers(
        http.get(endpoint, () => HttpResponse.json({ data: settings() })),
        http.patch(endpoint, async () => {
          started()
          await response.promise
          return HttpResponse.json({ data: { ...settings(), enabled: true } }, { status })
        })
      )
      render(<NotificationSettingsPage />)
      await screen.findByRole('button', { name: label('save') })
      fireEvent.click(screen.getByLabelText(label('enabled')))
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
      await waitFor(() => expect(started).toHaveBeenCalledOnce())
      expect(screen.getByRole('button', { name: label('save') })).toBeDisabled()
      identify(null)
      await act(async () => {
        response.release()
        await response.promise
      })
      expect(screen.queryByLabelText(label('enabled'))).toBeNull()
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    }
  )
})
