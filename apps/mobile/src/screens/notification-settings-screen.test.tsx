/* eslint-disable @typescript-eslint/await-thenable */
// R11: native settings rendering with actual generated HTTP and a controlled verified session.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { http, HttpResponse } from 'msw'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test-utils/msw/server'
import i18n, { initI18n } from '../lib/i18n'
const session = vi.hoisted(() => ({
  owner: null as string | null,
  listeners: new Set<() => void>(),
}))
const enable = vi.hoisted(() => vi.fn())
vi.mock('../lib/native-session', () => ({
  nativeSessionIdentity: () => session.owner,
  subscribeNativeSession: (fn: () => void) => {
    session.listeners.add(fn)
    return () => session.listeners.delete(fn)
  },
  signOutNativeSession: vi.fn(),
}))
vi.mock('../lib/mobile-auth', () => ({
  resolveMobileAccessToken: () =>
    Promise.resolve(session.owner ? `verified-${session.owner}` : undefined),
}))
vi.mock('../lib/native-notifications', () => ({
  enableNativeCommunityNotifications: enable,
}))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))
vi.mock('expo-router', () => ({ router: { push: vi.fn(), back: vi.fn() } }))
import NotificationSettingsScreen from '../../app/notification-settings'
const settings = () => ({
  enabled: true,
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timezone: 'UTC',
  timezoneConfigured: false,
  revision: 'revision-1',
})
const label = (key: string) => i18n.t(`community.notifications.${key}`)
function identify(owner: string | null) {
  act(() => {
    session.owner = owner
    session.listeners.forEach((fn) => fn())
  })
}
beforeAll(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
})
beforeEach(() => {
  session.owner = null
  session.listeners.clear()
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
})
describe('R11 native settings journeys', () => {
  it('waits for verification and clears old account settings immediately on switch/signout', async () => {
    const headers: string[] = []
    server.use(
      http.get('*/api/v1/community/notification-preferences', ({ request }) => {
        const bearer = request.headers.get('authorization')!
        headers.push(bearer)
        return HttpResponse.json({
          data: {
            ...settings(),
            timezoneConfigured: true,
            timezone: bearer.endsWith('member-a') ? 'Europe/London' : 'Europe/Paris',
          },
        })
      })
    )
    await render(<NotificationSettingsScreen />)
    expect(screen.queryByLabelText(label('timezone'))).toBeNull()
    identify('member-a')
    await screen.findByDisplayValue('Europe/London')
    identify('member-b')
    expect(screen.queryByDisplayValue('Europe/London')).toBeNull()
    await screen.findByDisplayValue('Europe/Paris')
    identify(null)
    expect(screen.queryByLabelText(label('timezone'))).toBeNull()
    expect(headers).toEqual(['Bearer verified-member-a', 'Bearer verified-member-b'])
  })
  it('recovers an already-enabled policy conflict and preserves a newly chosen shared timezone', async () => {
    let reads = 0
    const writes: unknown[] = []
    server.use(
      http.get('*/api/v1/community/notification-preferences', () => {
        reads++
        return HttpResponse.json({
          data:
            reads === 1
              ? settings()
              : {
                  ...settings(),
                  timezoneConfigured: true,
                  timezone: 'Europe/Paris',
                  revision: 'revision-2',
                },
        })
      }),
      http.patch('*/api/v1/community/notification-preferences', async ({ request }) => {
        writes.push(await request.json())
        return writes.length === 1
          ? HttpResponse.json({ code: 'revision_conflict' }, { status: 409 })
          : HttpResponse.json({
              data: {
                ...settings(),
                quietHoursEnabled: true,
                timezoneConfigured: true,
                timezone: 'Europe/Paris',
                revision: 'revision-3',
              },
            })
      })
    )
    session.owner = 'member-a'
    await render(<NotificationSettingsScreen />)
    await screen.findByDisplayValue('America/Chicago')
    fireEvent.click(screen.getByLabelText(label('quiet')))
    fireEvent.click(screen.getByRole('button', { name: label('save') }))
    await screen.findByDisplayValue('Europe/Paris')
    await waitFor(() => expect(screen.getByLabelText(label('quiet'))).toBeChecked())
    fireEvent.click(screen.getByRole('button', { name: label('save') }))
    await screen.findByText(label('saved'))
    expect(writes).toEqual([
      {
        baseRevision: 'revision-1',
        quietHoursEnabled: true,
        timezone: 'America/Chicago',
      },
      { baseRevision: 'revision-2', quietHoursEnabled: true },
    ])
    expect(enable).not.toHaveBeenCalled()
  })
})
