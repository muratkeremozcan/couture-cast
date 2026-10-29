/* eslint-disable @typescript-eslint/await-thenable */
// R11: native settings rendering with actual generated HTTP and a controlled verified session.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { AccessibilityInfo, Platform } from 'react-native'
import { http, HttpResponse } from 'msw'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test-utils/msw/server'
import i18n, { initI18n } from '../lib/i18n'
const session = vi.hoisted(() => ({
  owner: null as string | null,
  // False while the verified bearer has not settled after sign-in.
  ready: true,
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
    Promise.resolve(
      session.owner && session.ready ? `verified-${session.owner}` : undefined
    ),
}))
vi.mock('../lib/native-notifications', () => ({
  enableNativeCommunityNotifications: enable,
}))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))
vi.mock('expo-router', () => ({ router: { push: vi.fn(), back: vi.fn() } }))
vi.mock('../lib/notification-load-retry', () => ({
  LOAD_RETRY_DELAYS_MS: [150, 150, 150],
}))
import NotificationSettingsScreen from '../../app/notification-settings'
import deDE from '../../assets/locales/de-DE.json'
import enCA from '../../assets/locales/en-CA.json'
import enUS from '../../assets/locales/en-US.json'
import es419 from '../../assets/locales/es-419.json'
import frCA from '../../assets/locales/fr-CA.json'
import frFR from '../../assets/locales/fr-FR.json'
import itIT from '../../assets/locales/it-IT.json'
import ptBR from '../../assets/locales/pt-BR.json'
import ptPT from '../../assets/locales/pt-PT.json'
import trTR from '../../assets/locales/tr-TR.json'
const locales: Record<string, Record<string, string | undefined>> = {
  'de-DE': deDE.community.notifications,
  'en-CA': enCA.community.notifications,
  'en-US': enUS.community.notifications,
  'es-419': es419.community.notifications,
  'fr-CA': frCA.community.notifications,
  'fr-FR': frFR.community.notifications,
  'it-IT': itIT.community.notifications,
  'pt-BR': ptBR.community.notifications,
  'pt-PT': ptPT.community.notifications,
  'tr-TR': trTR.community.notifications,
}
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
  session.ready = true
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
  it('shows an error and recovers when sign-in, the identity reset and the first preferences load run before the bearer settles', async () => {
    server.use(
      http.get('*/api/v1/community/notification-preferences', () =>
        HttpResponse.json({ data: { ...settings(), timezoneConfigured: true } })
      )
    )
    session.ready = false
    await render(<NotificationSettingsScreen />)
    identify('member-a')
    // The identity reset signals the same member a second time; it must not strand the screen.
    identify('member-a')
    await screen.findByText(label('loadFailed'))
    expect(screen.queryByLabelText(label('timezone'))).toBeNull()
    session.ready = true
    await screen.findByDisplayValue('UTC', undefined, { timeout: 2000 })
    expect(screen.queryByText(label('loadFailed'))).toBeNull()
  })

  it('retries a preferences request that failed once and then shows the controls', async () => {
    let reads = 0
    server.use(
      http.get('*/api/v1/community/notification-preferences', () => {
        reads++
        return reads === 1
          ? HttpResponse.json({ error: 'unavailable' }, { status: 503 })
          : HttpResponse.json({ data: { ...settings(), timezoneConfigured: true } })
      })
    )
    await render(<NotificationSettingsScreen />)
    identify('member-a')
    await screen.findByText(label('loadFailed'))
    await screen.findByDisplayValue('UTC', undefined, { timeout: 2000 })
    expect(reads).toBe(2)
  })

  it('keeps the error visible while the bearer never settles', async () => {
    session.ready = false
    await render(<NotificationSettingsScreen />)
    identify('member-a')
    await screen.findByText(label('loadFailed'))
    expect(screen.queryByLabelText(label('timezone'))).toBeNull()
  })

  it('names a load failure as a load, not as a failed save', async () => {
    session.ready = false
    await render(<NotificationSettingsScreen />)
    identify('member-a')
    await screen.findByText(label('loadFailed'))
    expect(screen.queryByText(label('failed'))).toBeNull()
    expect(label('loadFailed')).not.toBe(label('failed'))
  })

  it('offers an accessible Try again control once the bounded retries stop, and it reloads', async () => {
    session.ready = false
    await render(<NotificationSettingsScreen />)
    identify('member-a')
    const retry = await screen.findByRole('button', { name: label('retry') })
    expect(retry.getAttribute('aria-label') ?? retry.textContent).toContain(
      label('retry')
    )
    expect(screen.queryByLabelText(label('timezone'))).toBeNull()
    server.use(
      http.get('*/api/v1/community/notification-preferences', () =>
        HttpResponse.json({ data: { ...settings(), timezoneConfigured: true } })
      )
    )
    session.ready = true
    fireEvent.click(retry)
    await screen.findByDisplayValue('UTC', undefined, { timeout: 2000 })
    expect(screen.queryByRole('button', { name: label('retry') })).toBeNull()
    expect(screen.queryByText(label('loadFailed'))).toBeNull()
  })

  it('shows no Try again control while retries are still pending or after a load succeeds', async () => {
    server.use(
      http.get('*/api/v1/community/notification-preferences', () =>
        HttpResponse.json({ data: { ...settings(), timezoneConfigured: true } })
      )
    )
    await render(<NotificationSettingsScreen />)
    identify('member-a')
    await screen.findByDisplayValue('UTC')
    expect(screen.queryByRole('button', { name: label('retry') })).toBeNull()
  })

  it('announces a load failure on iOS only, where the live region is not honoured', async () => {
    const announce = vi
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined)
    const original = Platform.OS
    try {
      Platform.OS = 'ios'
      session.ready = false
      await render(<NotificationSettingsScreen />)
      identify('member-a')
      await screen.findByText(label('loadFailed'))
      await waitFor(() => expect(announce).toHaveBeenCalledWith(label('loadFailed')))
      announce.mockClear()
      Platform.OS = 'android'
      identify(null)
      identify('member-b')
      await screen.findByText(label('loadFailed'))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(announce).not.toHaveBeenCalled()
    } finally {
      Platform.OS = original
      announce.mockRestore()
    }
  })

  it('offers Try again only after the last automatic retry fails', async () => {
    // Each request is held until released, so every state between two failures is observable.
    const gates: (() => void)[] = []
    server.use(
      http.get('*/api/v1/community/notification-preferences', async () => {
        await new Promise<void>((resolve) => gates.push(resolve))
        return HttpResponse.json({ error: 'unavailable' }, { status: 503 })
      })
    )
    const retry = () => screen.queryByRole('button', { name: label('retry') })
    await render(<NotificationSettingsScreen />)
    identify('member-a')
    // Four requests: the first load and one per scheduled retry. While request k is pending,
    // the k - 1 failures before it have happened and none of them may offer the button.
    for (const k of [1, 2, 3, 4]) {
      await waitFor(() => expect(gates).toHaveLength(k), { timeout: 2000 })
      expect(retry(), `no button while request ${k} is pending`).toBeNull()
      gates[k - 1]!()
    }
    await screen.findByRole('button', { name: label('retry') })
    expect(gates).toHaveLength(4)
  })

  it('has a load message and a Try again label in every supported locale', () => {
    for (const [locale, n] of Object.entries(locales)) {
      expect(n.loadFailed, locale).toBeTruthy()
      expect(n.retry, locale).toBeTruthy()
      expect(n.loadFailed, locale).not.toBe(n.failed)
      expect(n.loadFailed!.length, locale).toBeLessThan(90)
    }
    expect(Object.keys(locales)).toHaveLength(10)
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
