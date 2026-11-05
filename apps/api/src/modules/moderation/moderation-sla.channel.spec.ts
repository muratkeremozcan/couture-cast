// Story 6.12 test owner: the operations webhook adapter with a spy fetch. U-CH-CONFIG, U-CH-CODES,
// U-CH-NO-SECRET, U-CH-REQUEST, U-CH-PAYLOAD. The real socket is in moderation-sla-delivery.integration.spec.ts.
import { describe, expect, it, vi } from 'vitest'
import {
  moderationSlaFailureCodes,
  moderationSlaWebhookPayloadSchema,
  type ModerationSlaWebhookPayload,
} from '@couture/api-client/contracts/http'
import {
  buildModerationSlaPayload,
  createModerationOpsChannel,
} from './moderation-sla.channel.js'

const alert = {
  id: 'clx1',
  kind: 'breached' as const,
  source: 'post' as const,
  risk: 'high' as const,
  slaDueAt: new Date('2026-11-06T09:00:00.000Z'),
  detectedAt: new Date('2026-11-06T09:00:41.000Z'),
  caseId: 'post.abc',
}
const payload: ModerationSlaWebhookPayload = buildModerationSlaPayload(alert, {
  appUrl: 'https://example.test',
})
const okFetch = () => vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')))

describe('U-CH-CONFIG (TEA-03)', () => {
  it.each([[undefined], [null], [''], ['   '], ['\n\t']])(
    'url %j means the console channel',
    (url) => {
      expect(createModerationOpsChannel({ url: url as string }).kind).toBe('console')
    }
  )

  it.each([
    ['https://hooks.example.test/x'],
    ['http://localhost/x'],
    ['http://localhost:4599/x'],
    ['http://127.0.0.1:4599/x'],
    ['http://127.9.9.9/x'],
    ['http://[::1]:4599/x'],
  ])('%s sends', async (url) => {
    const fetchSpy = okFetch()
    const channel = createModerationOpsChannel({ url, fetch: fetchSpy })
    expect(channel.kind).toBe('webhook')
    await expect(channel.deliver(payload)).resolves.toBe('delivered')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['http://example.test/x'],
    ['http://localhost.evil.test/x'],
    ['http://127.0.0.1.nip.io/x'],
    ['http://127.evil.test/x'],
    ['http://128.0.0.1/x'],
    ['https://user:pw@example.test/x'],
    ['http://user:pw@127.0.0.1/x'],
    ['ftp://example.test/x'],
    ['not a url'],
  ])('%s is invalid_config with zero fetch calls', async (url) => {
    const fetchSpy = okFetch()
    const channel = createModerationOpsChannel({ url, fetch: fetchSpy })
    expect(channel.kind).toBe('webhook')
    await expect(channel.deliver(payload)).resolves.toBe('invalid_config')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('U-CH-CODES', () => {
  it.each([
    [200, 'delivered'],
    [201, 'delivered'],
    [204, 'delivered'],
    [301, 'http_3xx'],
    [302, 'http_3xx'],
    [307, 'http_3xx'],
    [400, 'http_4xx'],
    [404, 'http_4xx'],
    [429, 'http_4xx'],
    [500, 'http_5xx'],
    [503, 'http_5xx'],
  ])('status %d gives %s', async (status, outcome) => {
    const channel = createModerationOpsChannel({
      url: 'https://hooks.example.test/x',
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(status === 204 ? null : '{}', { status }))
      ),
    })
    await expect(channel.deliver(payload)).resolves.toBe(outcome)
  })

  it.each([
    ['AbortError', new DOMException('aborted', 'AbortError'), 'timeout'],
    ['TimeoutError', new DOMException('timed out', 'TimeoutError'), 'timeout'],
    ['TypeError', new TypeError('fetch failed'), 'network'],
    ['a plain Error', new Error('boom'), 'network'],
  ])('%s gives a closed code and does not reject', async (_name, thrown, code) => {
    const channel = createModerationOpsChannel({
      url: 'https://hooks.example.test/x',
      fetch: vi.fn<typeof fetch>(() => Promise.reject(thrown as Error)),
    })
    await expect(channel.deliver(payload)).resolves.toBe(code)
    expect(moderationSlaFailureCodes).toContain(code)
  })
})

describe('U-CH-NO-SECRET', () => {
  it('returns only a closed code on every path, with a canary in the URL', async () => {
    const secretUrl =
      'https://hooks.example.test/services/CANARYSECRET?token=CANARYSECRET'
    const paths: Promise<string>[] = [
      createModerationOpsChannel({
        url: secretUrl,
        fetch: vi.fn<typeof fetch>(() =>
          Promise.reject(new TypeError(`Request failed: ${secretUrl}`))
        ),
      }).deliver(payload),
      createModerationOpsChannel({
        url: secretUrl,
        fetch: vi.fn<typeof fetch>(() =>
          Promise.resolve(new Response('', { status: 500 }))
        ),
      }).deliver(payload),
      createModerationOpsChannel({
        url: 'http://CANARYSECRET.example.test/x',
        fetch: okFetch(),
      }).deliver(payload),
    ]
    for (const outcome of await Promise.all(paths)) {
      expect(outcome).not.toContain('CANARYSECRET')
      expect(moderationSlaFailureCodes).toContain(outcome)
    }
  })

  it('exposes no URL on the channel object', () => {
    const channel = createModerationOpsChannel({
      url: 'https://hooks.example.test/CANARYSECRET',
      fetch: okFetch(),
    })
    expect(JSON.stringify(channel)).not.toContain('CANARYSECRET')
  })
})

describe('U-CH-REQUEST (TEA-02)', () => {
  it('POSTs JSON with the alert id as the idempotency key, and follows no redirect', async () => {
    const fetchSpy = okFetch()
    await createModerationOpsChannel({
      url: 'https://hooks.example.test/x',
      fetch: fetchSpy,
    }).deliver(payload)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://hooks.example.test/x')
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' })
    const headers = new Headers(init!.headers)
    expect(headers.get('content-type')).toContain('application/json')
    expect(headers.get('idempotency-key')).toBe('clx1')
    expect(JSON.parse(init!.body as string)).toEqual(payload)
    expect(init!.signal).toBeInstanceOf(AbortSignal)
  })

  it('times out at 5000 ms by default, and an injected timeout replaces it', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      await createModerationOpsChannel({
        url: 'https://hooks.example.test/x',
        fetch: okFetch(),
      }).deliver(payload)
      expect(timeout).toHaveBeenLastCalledWith(5_000)
      await createModerationOpsChannel({
        url: 'https://hooks.example.test/x',
        fetch: okFetch(),
        timeoutMs: 50,
      }).deliver(payload)
      expect(timeout).toHaveBeenLastCalledWith(50)
    } finally {
      timeout.mockRestore()
    }
  })
})

describe('U-CH-PAYLOAD (TEA-12)', () => {
  it('equals the golden example byte for byte', () => {
    expect(JSON.stringify(payload)).toBe(
      JSON.stringify({
        id: 'clx1',
        kind: 'breached',
        source: 'post',
        risk: 'high',
        slaDueAt: '2026-11-06T09:00:00.000Z',
        detectedAt: '2026-11-06T09:00:41.000Z',
        casePath: '/moderation/cases/post.abc',
        caseUrl: 'https://example.test/moderation/cases/post.abc',
        text: 'Moderation SLA breached: high risk post case. https://example.test/moderation/cases/post.abc',
      })
    )
    expect(moderationSlaWebhookPayloadSchema.parse(payload)).toEqual(payload)
  })

  it('leaves one slash for an app URL with a trailing slash', () => {
    expect(
      buildModerationSlaPayload(alert, { appUrl: 'https://example.test/' }).caseUrl
    ).toBe('https://example.test/moderation/cases/post.abc')
  })

  it.each([[undefined], [null], ['']])(
    'app URL %j gives a null caseUrl and a path in the text, with no localhost default',
    (appUrl) => {
      const built = buildModerationSlaPayload(alert, { appUrl: appUrl as string })
      expect(built.caseUrl).toBeNull()
      expect(built.text).toContain('/moderation/cases/post.abc')
      expect(JSON.stringify(built)).not.toContain('localhost')
      expect(moderationSlaWebhookPayloadSchema.parse(built)).toEqual(built)
    }
  )

  it.each([
    ['at_risk', 'Moderation SLA at risk: high risk post case.'],
    ['breached', 'Moderation SLA breached: high risk post case.'],
    ['escalated', 'Moderation case escalated: high risk post case.'],
  ] as const)('%s has its one template', (kind, opening) => {
    expect(
      buildModerationSlaPayload({ ...alert, kind }, { appUrl: 'https://example.test' })
        .text
    ).toMatch(new RegExp(`^${opening} https://example\\.test/`))
  })
})
