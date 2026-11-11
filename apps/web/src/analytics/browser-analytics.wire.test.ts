// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import { webcrypto } from 'node:crypto'
import { createElement } from 'react'
import { gunzipSync } from 'node:zlib'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import posthog from 'posthog-js'
import type * as ApiClient from '@couture/api-client'
import { preparedShareCardFixture } from '@couture/api-client/testing/share-card-fixture'
import {
  SHARE_CARD_SHARED_ALLOWED_PROPERTIES,
  trackShareCardShared,
} from '@couture/api-client'

// The real posthog-js reads `fetch` once, when it loads, so the transport is replaced
// before any import. Only PostHog's own requests stop here; everything else continues.
const wire = vi.hoisted(() => {
  // A real browser user agent, read once by posthog-js, so $os and $browser are set.
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  })
  const requests: { url: string; body: unknown }[] = []
  const previous = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith('/ingest')) return previous(input, init)
    requests.push({ url, body: init?.body })
    return Promise.resolve(
      new Response(JSON.stringify({ status: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  }) as typeof fetch
  return { requests }
})
const sanitizer = vi.hoisted(() => ({ fail: null as null | 'throw' | 'null' }))
vi.mock('@couture/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClient>()
  return {
    ...actual,
    sanitizeShareCardSharedProperties: (properties: unknown) => {
      if (sanitizer.fail === 'throw') throw new Error('deliberate_sanitizer_failure')
      if (sanitizer.fail === 'null') return null
      return actual.sanitizeShareCardSharedProperties(properties)
    },
  }
})

vi.mock('../lib/web-session', () => ({ webSessionIdentity: () => 'member-123' }))

import { useMswHandlers } from '../test-utils/msw/runtime'
import { currentI18n } from '../i18n'
import enUS from '../i18n/locales/en-US.json'
import { ShareCardControl } from '../app/components/share-card-dialog'
import { captureShareCardShared } from '../lib/share-cards'
import {
  SHARE_CARD_ANALYTICS_DROPPED,
  browserAnalytics,
  initializeBrowserAnalytics,
} from './browser-analytics'

type SerializedEvent = {
  event: string
  uuid?: string
  timestamp?: string
  offset?: number
  properties: Record<string, unknown>
  $set?: unknown
  $set_once?: unknown
}
const readBlob = (blob: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    // jsdom's Blob has no arrayBuffer(); FileReader reads the same bytes.
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsArrayBuffer(blob)
  })
async function decode(body: unknown): Promise<SerializedEvent[]> {
  const text =
    body instanceof Blob
      ? gunzipSync(await readBlob(body)).toString('utf8')
      : String(body)
  const parsed = JSON.parse(text) as SerializedEvent | SerializedEvent[]
  return Array.isArray(parsed) ? parsed : [parsed]
}
/** Lets the request queue flush, then returns every serialized event batch. */
async function flushBatches() {
  await vi.advanceTimersByTimeAsync(3500)
  const batches = []
  for (const request of wire.requests.splice(0))
    if (/^\/ingest\/(e|i\/v0\/e)\//.test(request.url))
      batches.push(await decode(request.body))
  return batches
}
const remoteConfig = {
  logs: { captureConsoleLogs: true },
  sessionRecording: { endpoint: '/s/' },
  surveys: true,
}
// A guardian invitation token as the API issues it: a JWT whose payload names the teen
// and the guardian's email.
const invitationToken =
  'eyJhbGciOiJIUzI1NiJ9.eyJ0ZWVuSWQiOiJ0ZWVuLTEiLCJndWFyZGlhbkVtYWlsIjoiZ0BleC50ZXN0In0.c2lnbmF0dXJl'
async function bodyText(body: unknown): Promise<string> {
  if (body instanceof Blob) {
    const bytes = await readBlob(body)
    try {
      return gunzipSync(bytes).toString('utf8')
    } catch {
      return new TextDecoder().decode(bytes)
    }
  }
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? null)
  // Flags and config requests with base64 compression send `data=<base64 JSON>`.
  return text.startsWith('data=')
    ? Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString('utf8')
    : text
}
/**
 * Lets the request queue flush, then returns the captured events and every request to
 * /ingest (URL and decoded body, flags and config included) as one string.
 */
async function drain() {
  await vi.advanceTimersByTimeAsync(3500)
  const events: SerializedEvent[] = []
  const bodies: string[] = []
  for (const request of wire.requests.splice(0)) {
    const text = await bodyText(request.body)
    bodies.push(request.url, text)
    if (/^\/ingest\/(e|i\/v0\/e)\//.test(request.url)) {
      const parsed = JSON.parse(text) as SerializedEvent | SerializedEvent[]
      events.push(...(Array.isArray(parsed) ? parsed : [parsed]))
    }
  }
  return { events, serialized: bodies.join('\n') }
}
const invitationPath = `/guardian/accept?token=${invitationToken}&email=teen%40example.test#frag-teen`
const personalUuid = '01234567-89ab-cdef-0123-456789abcdef'
function expectNoLeak(serialized: string) {
  for (const leak of [
    invitationToken,
    'eyJ',
    'teen@example.test',
    'teen%40example.test',
    'frag-teen',
    'Alice',
    'alice',
    '2011-04-01',
    personalUuid,
    'guardian-secret',
    'case-123',
    'post-123',
    'private-photo',
    'photo-secret',
    'private-campaign',
    'member@example.test',
  ])
    expect(serialized).not.toContain(leak)
}
let firstVisit: Awaited<ReturnType<typeof drain>>
let firstVisitStorage = ''
// The web client sends every allowlisted key: the business keys, its locale, the GeoIP,
// IP and person profile switches and the SDK identity and transport keys.
const WEB_ALLOWLIST = [...SHARE_CARD_SHARED_ALLOWED_PROPERTIES].sort()
const shareProperties = {
  ...trackShareCardShared({
    client: 'web',
    target: 'unknown',
    outcome: 'handed_off',
    duration_ms: 1250,
  }),
  locale: 'en-US',
}

beforeAll(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubEnv('POSTHOG_API_KEY', 'phc_wire_test')
  // A fresh visitor whose first page is the guardian invitation link.
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.pushState({}, '', invitationPath)
  // The project's remote config, preloaded the way the token-specific array.js bundle
  // delivers it, with console log capture, replay and surveys switched on remotely.
  ;(window as unknown as { _POSTHOG_REMOTE_CONFIG: object })._POSTHOG_REMOTE_CONFIG = {
    phc_wire_test: { config: remoteConfig },
  }
  initializeBrowserAnalytics()
  firstVisit = await drain()
  firstVisitStorage = JSON.stringify([
    ...Object.entries(window.localStorage),
    ...Object.entries(window.sessionStorage),
    document.cookie,
  ])
  window.history.pushState({}, '', '/community/posts/post-123?ref=private-campaign')
  posthog.register({ plan_tier: 'premium' })
  posthog.identify('member-123', { email: 'member@example.test' })
  await drain()
})
afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  window.history.pushState({}, '', '/')
})

describe('I-SHARE-WIRE-WEB: the serialized posthog-js batch', () => {
  it('holds one share event with only the web allowlist and its envelope intact', async () => {
    // The dialog's own capture path, in a non-default locale.
    await currentI18n().changeLanguage('de-DE')
    try {
      captureShareCardShared(
        { outcome: 'handed_off', target: 'unknown' },
        performance.now() - 1250
      )
    } finally {
      await currentI18n().changeLanguage('en-US')
    }
    browserAnalytics.capture('ritual_created', { ritual_type: 'daily_outfit' })
    const events = (await flushBatches()).flat()
    const shares = events.filter(({ event }) => event === 'share_card_shared')
    expect(shares).toHaveLength(1)
    const [share] = shares
    expect(Object.keys(share!.properties).sort()).toEqual(WEB_ALLOWLIST)
    expect(share!.properties).toMatchObject({
      client: 'web',
      target: 'unknown',
      outcome: 'handed_off',
      duration_ms: expect.any(Number) as number,
      locale: 'de-DE',
      $geoip_disable: true,
      $ip: null,
      $process_person_profile: false,
      token: 'phc_wire_test',
      distinct_id: 'member-123',
      $lib: 'web',
    })
    // The envelope: event, uuid and the SDK's own time field; no person updates.
    expect(share!.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(share!.timestamp ?? share!.offset).toBeDefined()
    expect(
      Object.keys(share!)
        .filter((key) => key !== 'timestamp' && key !== 'offset')
        .sort()
    ).toEqual(['event', 'properties', 'uuid'])
    expect(share).not.toHaveProperty('$set')
    expect(share).not.toHaveProperty('$set_once')
    const serialized = JSON.stringify(share)
    for (const leak of ['post-123', 'private-campaign', 'premium', 'member@example.test'])
      expect(serialized).not.toContain(leak)
    // Every other event keeps its own allowlist: no super property, a route URL.
    const other = events.find(({ event }) => event === 'ritual_created')
    expect(other?.properties).toMatchObject({
      ritual_type: 'daily_outfit',
      $current_url: expect.stringMatching(/^http:\/\/localhost:\d+\/:unknown$/) as string,
    })
    expect(other?.properties).not.toHaveProperty('plan_tier')
  })

  it('U-ANALYTICS-PRIVACY-WEB: a fresh client on the invitation page sends nothing personal', () => {
    // No feature flag or remote config request at all, so no person properties leave.
    const requests = firstVisit.serialized
      .split('\n')
      .filter((line) => line.startsWith('/ingest'))
    expect(requests.length).toBeGreaterThan(0)
    for (const url of requests) expect(url).not.toMatch(/\/(flags|decide|config)\b/)
    const pageview = firstVisit.events.find(({ event }) => event === '$pageview')
    expect(pageview?.properties).toMatchObject({
      $current_url: expect.stringMatching(
        /^http:\/\/localhost:\d+\/guardian\/accept$/
      ) as string,
      $pathname: '/guardian/accept',
    })
    for (const event of firstVisit.events) {
      expect(event).not.toHaveProperty('$set')
      expect(event).not.toHaveProperty('$set_once')
    }
    expectNoLeak(firstVisit.serialized)
    // What the SDK keeps on the device holds no credential, and the cookie no URL.
    for (const leak of [
      invitationToken,
      'eyJ',
      'teen%40example.test',
      'teen@example.test',
    ])
      expect(firstVisitStorage).not.toContain(leak)
    expect(firstVisitStorage).not.toContain('$initial_person_info')
    expect(document.cookie).not.toContain('guardian')
  })

  it('U-ANALYTICS-PRIVACY-WEB: paths leave as known route templates only', async () => {
    window.history.pushState({}, '', invitationPath)
    try {
      posthog.capture('deep_link_invalid', {
        rawUrl: window.location.href,
        reason: `token=${invitationToken}`,
        surface: 'web',
      })
      window.history.pushState(
        {},
        '',
        '/moderation/cases/case-123?note=teen%40example.test'
      )
      window.history.pushState({}, '', '/profile/alice-smith/reset/guardian-secret')
      browserAnalytics.capture('external_link_tapped', {
        url: 'https://weather.example/alerts/alice-smith?email=teen@example.test',
      })
      const { events, serialized } = await drain()
      const invalid = events.find(({ event }) => event === 'deep_link_invalid')
      expect(invalid?.properties).toMatchObject({
        rawUrl: expect.stringMatching(/\/guardian\/accept$/) as string,
        surface: 'web',
      })
      expect(invalid?.properties).not.toHaveProperty('reason')
      const paths = events
        .filter(({ event }) => event === '$pageview')
        .map(({ properties }) => properties.$pathname)
      expect(paths).toEqual(
        expect.arrayContaining(['/moderation/cases/:param', '/:unknown'])
      )
      const external = events.find(({ event }) => event === 'external_link_tapped')
      expect(external?.properties.url).toBe('https://weather.example')
      expectNoLeak(serialized)
    } finally {
      window.history.pushState({}, '', '/community/posts/post-123?ref=private-campaign')
    }
  })

  it('U-ANALYTICS-PRIVACY-WEB: exceptions leave as type and code locations only', async () => {
    const error = new Error(
      `Invalid token=guardian-secret for Alice Smith, DOB 2011-04-01, email teen%40example.test ${invitationToken} https://cdn.test/private/${personalUuid}/private-photo.jpg?token=photo-secret`
    )
    posthog.captureException(error)
    const { events, serialized } = await drain()
    const exception = events.find(({ event }) => event === '$exception')
    expect(Object.keys(exception!.properties)).not.toContain('$exception_values')
    const [entry] = exception!.properties.$exception_list as {
      type: string
      value: string
      stacktrace: { frames: Record<string, unknown>[] }
    }[]
    expect(entry!.type).toBe('Error')
    expect(entry!.value).toBe('redacted')
    for (const frame of entry!.stacktrace.frames) {
      expect(Object.keys(frame).sort()).toEqual(
        expect.arrayContaining(['filename', 'in_app'])
      )
      expect(frame.filename).toMatch(/^(?:<unknown>|[A-Za-z0-9_.-]+)$/)
    }
    expectNoLeak(serialized)
  })

  it('U-ANALYTICS-PRIVACY-WEB: a remote config that turns on console logs never loads the logs extension', async () => {
    await vi.advanceTimersByTimeAsync(1000)
    const scriptSources = [...document.querySelectorAll('script')].map(
      (script) => script.src
    )
    expect(scriptSources.filter((src) => /\/static\/logs\.js/.test(src))).toEqual([])
    expect(
      scriptSources.filter((src) => /recorder|surveys|config\.js/.test(src))
    ).toEqual([])
    expect(
      (window as unknown as { __PosthogExtensions__?: { logs?: unknown } })
        .__PosthogExtensions__?.logs
    ).toBeUndefined()
  })

  it.each(['throw', 'null'] as const)(
    'a sanitizer that fails closed (%s) drops the share event and logs a closed code',
    async (mode) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      sanitizer.fail = mode
      try {
        expect(() =>
          browserAnalytics.capture('share_card_shared', shareProperties)
        ).not.toThrow()
        browserAnalytics.capture('ritual_created', { ritual_type: 'daily_outfit' })
        const events = (await flushBatches()).flat()
        expect(events.filter(({ event }) => event === 'share_card_shared')).toEqual([])
        expect(events.some(({ event }) => event === 'ritual_created')).toBe(true)
        expect(warn).toHaveBeenCalledWith(SHARE_CARD_ANALYTICS_DROPPED)
        for (const [message] of warn.mock.calls)
          expect(message).toBe(SHARE_CARD_ANALYTICS_DROPPED)
      } finally {
        sanitizer.fail = null
      }
    }
  )

  it('a failing sanitizer leaves the share outcome, copy and focus unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001')
    vi.stubGlobal('crypto', webcrypto)
    const share = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true,
    })
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await currentI18n().changeLanguage('en-US')
    useMswHandlers(
      http.get('http://localhost:3001/api/v1/share-cards/capabilities', () =>
        HttpResponse.json({ data: { nativeShare: true } })
      ),
      http.post('http://localhost:3001/api/v1/share-cards/prepare', () =>
        HttpResponse.json({ data: preparedShareCardFixture })
      )
    )
    sanitizer.fail = 'throw'
    try {
      render(
        createElement(ShareCardControl, {
          source: { kind: 'outfit', recommendationId: 'owned' },
        })
      )
      await userEvent.click(screen.getByTestId('share-card-open'))
      fireEvent.load(await screen.findByTestId('share-card-preview'))
      const button = await screen.findByTestId('share-card-share')
      await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
      await userEvent.click(button)
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(enUS.shareCard.sentToApp)
      )
      expect(button).toHaveFocus()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(share).toHaveBeenCalledOnce()
      const events = (await flushBatches()).flat()
      expect(events.filter(({ event }) => event === 'share_card_shared')).toEqual([])
      expect(warn).toHaveBeenCalledExactlyOnceWith(SHARE_CARD_ANALYTICS_DROPPED)
    } finally {
      sanitizer.fail = null
      Reflect.deleteProperty(navigator, 'canShare')
      Reflect.deleteProperty(navigator, 'share')
    }
  })
})
