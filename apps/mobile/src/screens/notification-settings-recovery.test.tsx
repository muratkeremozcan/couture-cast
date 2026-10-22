/* eslint-disable @typescript-eslint/await-thenable */
// R11: native settings rendering with actual generated HTTP and a controlled verified session.
import type * as ReactNative from 'react-native'
import { router } from 'expo-router'
import { signOutNativeSession } from '../lib/native-session'
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
const deviceSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNative>()
  return { ...actual, Linking: { ...actual.Linking, openSettings: deviceSettings } }
})
vi.mock('../lib/native-session', () => ({
  nativeSessionIdentity: () => session.owner,
  subscribeNativeSession: (fn: () => void) => {
    session.listeners.add(fn)
    return () => session.listeners.delete(fn)
  },
  signOutNativeSession: vi.fn().mockResolvedValue(undefined),
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
import { NativeNotificationFailure } from '../lib/native-notification-errors'
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
// Keep React's async act scope open through event-scheduled microtasks.
async function interact(action: () => void) {
  await act(async () => {
    action()
    await Promise.resolve()
  })
}
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

describe('notification settings failure, retry and cleanup journeys', () => {
  it('edits quiet hours and explicit timezone and saves only the intended changes', async () => {
    session.owner = 'member-a'
    const writes: unknown[] = []
    server.use(
      http.get('*/api/v1/community/notification-preferences', () =>
        HttpResponse.json({ data: { ...settings(), timezoneConfigured: true } })
      ),
      http.patch('*/api/v1/community/notification-preferences', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        writes.push(body)
        return HttpResponse.json({
          data: {
            ...settings(),
            ...body,
            baseRevision: undefined,
            revision: 'revision-2',
            timezoneConfigured: true,
          },
        })
      })
    )
    await render(<NotificationSettingsScreen />)
    await screen.findByDisplayValue('UTC')
    await interact(() => {
      fireEvent.change(screen.getByLabelText(label('start')), {
        target: { value: '21:15' },
      })
      fireEvent.change(screen.getByLabelText(label('end')), {
        target: { value: '08:30' },
      })
      fireEvent.change(screen.getByLabelText(label('timezone')), {
        target: { value: 'Europe/Paris' },
      })
    })
    await interact(() => {
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
    })
    await screen.findByText(label('saved'))
    expect(writes).toEqual([
      {
        baseRevision: 'revision-1',
        quietHoursStart: '21:15',
        quietHoursEnd: '08:30',
        timezone: 'Europe/Paris',
      },
    ])
  })
  it('explains permission refusal, opens device settings, then retries enablement', async () => {
    session.owner = 'member-a'
    server.use(
      http.get('*/api/v1/community/notification-preferences', () =>
        HttpResponse.json({
          data: { ...settings(), enabled: false, timezoneConfigured: true },
        })
      )
    )
    enable
      .mockRejectedValueOnce(new Error('notification_permission_denied'))
      .mockResolvedValue({
        ...settings(),
        timezoneConfigured: true,
        revision: 'enabled-revision',
      })
    const openSettings = deviceSettings
    await render(<NotificationSettingsScreen />)
    await screen.findByDisplayValue('UTC')
    await interact(() => {
      fireEvent.click(screen.getByLabelText(label('enabled')))
    })
    await interact(() => {
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
    })
    await screen.findByText(label('permission'))
    await interact(() => {
      fireEvent.click(screen.getByRole('button', { name: label('deviceSettings') }))
    })
    expect(openSettings).toHaveBeenCalledTimes(1)
    await interact(() => {
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
    })
    await screen.findByText(label('saved'))
    expect(enable).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText(label('enabled'))).toBeChecked()
  })
  it.each([
    ['bindingConflict', 'Notification binding changed.'],
    ['pushUnavailable', 'Push notifications are not available on this device.'],
  ] as const)(
    'explains a %s registration failure with its own copy',
    async (reason, detail) => {
      session.owner = 'member-a'
      server.use(
        http.get('*/api/v1/community/notification-preferences', () =>
          HttpResponse.json({
            data: { ...settings(), enabled: false, timezoneConfigured: true },
          })
        )
      )
      enable.mockRejectedValueOnce(new NativeNotificationFailure(reason, detail))
      await render(<NotificationSettingsScreen />)
      await screen.findByDisplayValue('UTC')
      await interact(() => {
        fireEvent.click(screen.getByLabelText(label('enabled')))
      })
      await interact(() => {
        fireEvent.click(screen.getByRole('button', { name: label('save') }))
      })
      await screen.findByText(label(reason))
      expect(screen.queryByText(label('conflict'))).toBeNull()
      expect(screen.queryByRole('button', { name: label('deviceSettings') })).toBeNull()
    }
  )
  it('retains a draft after server failure and succeeds on explicit retry', async () => {
    session.owner = 'member-a'
    let writes = 0
    server.use(
      http.get('*/api/v1/community/notification-preferences', () =>
        HttpResponse.json({ data: { ...settings(), timezoneConfigured: true } })
      ),
      http.patch('*/api/v1/community/notification-preferences', () =>
        ++writes === 1
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json({
              data: {
                ...settings(),
                timezoneConfigured: true,
                quietHoursEnabled: true,
                revision: 'revision-2',
              },
            })
      )
    )
    await render(<NotificationSettingsScreen />)
    await screen.findByDisplayValue('UTC')
    await interact(() => {
      fireEvent.click(screen.getByLabelText(label('quiet')))
    })
    await interact(() => {
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
    })
    await screen.findByText(label('failed'))
    expect(screen.getByLabelText(label('quiet'))).toBeChecked()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label('save') })).not.toBeDisabled()
    )
    await interact(() => {
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
    })
    await waitFor(() => expect(writes).toBe(2))
    await screen.findByText(label('saved'))
  })
  it('contains conflict reload failure and keeps the editable draft', async () => {
    session.owner = 'member-a'
    let reads = 0
    server.use(
      http.get('*/api/v1/community/notification-preferences', () =>
        ++reads === 1
          ? HttpResponse.json({ data: settings() })
          : HttpResponse.json({}, { status: 503 })
      ),
      http.patch('*/api/v1/community/notification-preferences', () =>
        HttpResponse.json({ code: 'revision_conflict' }, { status: 409 })
      )
    )
    await render(<NotificationSettingsScreen />)
    await screen.findByDisplayValue('America/Chicago')
    await interact(() => {
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
    })
    await screen.findByText(label('failed'))
    expect(screen.getByLabelText(label('timezone'))).toHaveValue('America/Chicago')
    expect(screen.getByRole('button', { name: label('save') })).not.toBeDisabled()
  })
  it('retires an in-flight save on account switch and removes the owner subscription on unmount', async () => {
    session.owner = 'member-a'
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let writes = 0
    server.use(
      http.get('*/api/v1/community/notification-preferences', ({ request }) =>
        HttpResponse.json({
          data: {
            ...settings(),
            timezoneConfigured: true,
            timezone: request.headers.get('authorization')?.endsWith('member-b')
              ? 'Europe/London'
              : 'UTC',
          },
        })
      ),
      http.patch('*/api/v1/community/notification-preferences', async () => {
        writes++
        await held
        return HttpResponse.json({
          data: { ...settings(), timezone: 'Europe/Paris', timezoneConfigured: true },
        })
      })
    )
    const view = await render(<NotificationSettingsScreen />)
    await screen.findByDisplayValue('UTC')
    await interact(() => {
      fireEvent.click(screen.getByLabelText(label('quiet')))
      fireEvent.click(screen.getByRole('button', { name: label('save') }))
    })
    await waitFor(() => expect(writes).toBe(1))
    identify('member-b')
    await screen.findByDisplayValue('Europe/London')
    await act(async () => {
      release()
      await held
    })
    await waitFor(() =>
      expect(screen.getByLabelText(label('timezone'))).toHaveValue('Europe/London')
    )
    expect(screen.queryByText(label('saved'))).toBeNull()
    await view.unmount()
    expect(session.listeners.size).toBe(0)
  })
  it('reports initial load failure and supports sign-in and completed sign-out navigation', async () => {
    session.owner = 'member-a'
    server.use(
      http.get('*/api/v1/community/notification-preferences', () =>
        HttpResponse.json({}, { status: 503 })
      )
    )
    await render(<NotificationSettingsScreen />)
    await screen.findByText(label('failed'))
    await interact(() => {
      fireEvent.click(screen.getByRole('link', { name: label('signin') }))
    })
    expect(router.push).toHaveBeenCalledWith('/signin')
    await interact(() => {
      fireEvent.click(screen.getByRole('button', { name: label('signout') }))
    })
    expect(signOutNativeSession).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1))
  })
})
