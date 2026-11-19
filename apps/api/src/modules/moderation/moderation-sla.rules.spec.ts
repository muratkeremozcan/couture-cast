// Story 6.12 test owner: the pure rules of the SLA sweep. U-S-BOUNDARY, U-S-RELEVANCE, U-S-BACKOFF,
// U-R-STALE, the dedupe key, and the source scans U-S-NO-THRESHOLD, U-S-NO-DB-CLOCK and I-S-NO-REOPEN.
// The oracle tables are written by hand from the spec, so a change to the rule fails here.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  moderationSlaFailureCodes,
  moderationSlaWebhookPayloadSchema,
  type ModerationSlaDrillPayload,
  type ModerationSlaWebhookPayload,
} from '@couture/api-client/contracts/http'
import {
  buildModerationSlaPayload,
  createModerationOpsChannel,
  parseModerationOpsPushUserIds,
  readExpoPushReceipts,
  type ModerationOpsPushAccepted,
  type ModerationOpsPushTokens,
} from './moderation-sla.channel.js'
import {
  isModerationSlaMonitorStale,
  moderationSlaAlertKind,
  moderationSlaAlertRelevance,
  moderationSlaBackoffMs,
  moderationSlaDedupeKey,
} from './moderation-sla.rules.js'

const NOW = new Date('2026-11-05T12:00:00.000Z')
const SIX_HOURS = 6 * 60 * 60 * 1000
const MINUTE = 60_000
const inMs = (ms: number) => new Date(NOW.getTime() + ms)

describe('U-S-BOUNDARY: the kind comes from deriveSlaState', () => {
  it.each([
    [SIX_HOURS + 1, null],
    [SIX_HOURS, 'at_risk'],
    [1, 'at_risk'],
    [0, 'breached'],
    [-1, 'breached'],
    [-30 * 24 * SIX_HOURS, 'breached'],
  ])('remaining %d ms gives %s', (remaining, kind) => {
    expect(moderationSlaAlertKind({ dueAt: inMs(remaining), now: NOW })).toBe(kind)
  })

  it('throws on an unparseable time, so a bad row cannot read as on track', () => {
    expect(() =>
      moderationSlaAlertKind({ dueAt: new Date('not a date'), now: NOW })
    ).toThrow(RangeError)
  })
})

describe('moderationSlaDedupeKey (D5)', () => {
  it('anchors on a report, per source and kind', () => {
    expect(
      moderationSlaDedupeKey({ kind: 'at_risk', source: 'post', anchorReportId: 'r1' })
    ).toBe('sla:post:r1:at_risk')
    expect(
      moderationSlaDedupeKey({
        kind: 'breached',
        source: 'comment',
        anchorReportId: 'r1',
      })
    ).toBe('sla:comment:r1:breached')
  })

  it('keys an escalation on its decision', () => {
    expect(
      moderationSlaDedupeKey({
        kind: 'escalated',
        source: 'post',
        anchorReportId: 'r1',
        decisionId: 'd1',
      })
    ).toBe('escalated:d1')
  })
})

describe('U-S-RELEVANCE (D6, TEA-19)', () => {
  const dueSoon = inMs(MINUTE)
  it.each([
    ['at_risk', dueSoon, false, 'send'],
    ['at_risk', dueSoon, true, 'supersede'],
    ['at_risk', dueSoon, null, 'supersede'],
    ['at_risk', NOW, false, 'supersede'],
    ['at_risk', inMs(-1), false, 'supersede'],
    ['at_risk', inMs(1), false, 'send'],
    ['breached', inMs(-1), false, 'send'],
    ['breached', inMs(-1), true, 'supersede'],
    ['breached', inMs(-1), null, 'supersede'],
    ['escalated', dueSoon, false, 'send'],
    ['escalated', inMs(-1), false, 'send'],
    ['escalated', inMs(-1), true, 'supersede'],
    ['escalated', dueSoon, null, 'supersede'],
  ] as const)(
    '%s due %s with anchorResolved %s: %s',
    (kind, slaDueAt, anchorResolved, outcome) => {
      expect(
        moderationSlaAlertRelevance({ kind, slaDueAt, anchorResolved, now: NOW })
      ).toBe(outcome)
    }
  )
})

describe('U-S-BACKOFF (D9)', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 8],
    [5, 16],
    [6, 30],
    [7, 30],
    [20, 30],
    [10_000, 30],
  ])('failed attempt %d waits %d minutes', (attempts, minutes) => {
    expect(moderationSlaBackoffMs(attempts)).toBe(minutes * MINUTE)
  })
})

describe('U-R-STALE (D11)', () => {
  it.each([
    [null, true],
    [inMs(-(4 * MINUTE + 59_999)), false],
    [inMs(-5 * MINUTE), false],
    [inMs(-5 * MINUTE - 1), true],
    [NOW, false],
  ])('last sweep %s is stale %s', (lastSweepAt, stale) => {
    expect(isModerationSlaMonitorStale(lastSweepAt, NOW)).toBe(stale)
  })
})

describe('source scans', () => {
  const moderationDir = __dirname
  const sources = readdirSync(moderationDir)
    .filter((name) => /^moderation-sla\..*\.ts$/.test(name) && !name.endsWith('.spec.ts'))
    .map((name) => ({
      name,
      text: readFileSync(join(moderationDir, name), 'utf8'),
    }))

  it('U-S-NO-THRESHOLD: the sweep sources exist and copy no SLA threshold', () => {
    expect(sources.map((source) => source.name)).toEqual(
      expect.arrayContaining([
        'moderation-sla.channel.ts',
        'moderation-sla.repository.ts',
        'moderation-sla.rules.ts',
        'moderation-sla.sweep.ts',
      ])
    )
    for (const { name, text } of sources)
      expect(text, name).not.toMatch(
        // Any literal hour count except the 24 in the resolution window's day length.
        /21_?600(_?000)?\b|\b(?!24\b)\d+ \* 60 \* 60|interval '\d+ hours?'/
      )
  })

  it('U-S-NO-DB-CLOCK: new SQL reads no database clock and binds no Date (TEA-15)', () => {
    const repository = sources.find(
      (source) => source.name === 'moderation-sla.repository.ts'
    )
    expect(repository).toBeDefined()
    const code = repository!.text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
    expect(code).not.toMatch(/\bnow\(\)|CURRENT_TIMESTAMP|timestamptz/i)
    // Every instant in a raw template is cast from text. A bare interpolation beside a column is the defect.
    const rawTemplates =
      code.match(/(\$queryRaw|\$executeRaw|Prisma\.sql)`[^`]*`/gs) ?? []
    expect(rawTemplates.length).toBeGreaterThan(0)
    for (const template of rawTemplates)
      expect(template).not.toMatch(/\$\{[^}]+\}(?!::timestamp)/)
  })

  it('I-S-NO-REOPEN: no code path clears resolved_at (D2)', () => {
    const apiSrc = join(moderationDir, '..', '..')
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : [path]
      })
    const offenders = walk(apiSrc)
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.spec.ts'))
      .filter((path) => {
        const text = readFileSync(path, 'utf8')
        return (
          /data:\s*\{[^}]*resolved_at:\s*null/s.test(text) ||
          /"?resolved_at"?\s*=\s*NULL/i.test(text)
        )
      })
    expect(offenders).toEqual([])
  })
})

// Story 6.12 test owner: the operations webhook adapter with a spy fetch. U-CH-CONFIG, U-CH-CODES,
// U-CH-NO-SECRET, U-CH-REQUEST, U-CH-PAYLOAD. The real socket is in moderation-sla-delivery.integration.spec.ts.
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

// Production follow-up 2026-11-19: the Expo push channel. U-CH-PUSH-CONFIG, -REQUEST, -BATCH,
// -AUTH, -OUTCOMES, -ACCEPTED, U-CH-RECEIPTS-READ and U-CH-PUSH-IDS. Endpoints, limits and the
// lock-screen text are written out by hand, so a changed constant fails here. The factory, its token
// query and the sweep's receipt settling run on a real database in moderation-sla-push.integration.spec.ts.
const EXPO_SEND = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts'
const MODERATORS = ['mod-1', 'mod-2']
const DEVICES = ['ExponentPushToken[device-a]', 'ExponentPushToken[device-b]']
const device = (index: number) => `ExponentPushToken[device-${index}]`
const errorTicket = (error: string) => ({
  status: 'error',
  message: error,
  details: { error },
})
const json200 = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
type PushMessage = { to: string }
const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString()
/** Every message accepted, with a ticket id derived from its device. */
const acceptAll = (messages: PushMessage[]) =>
  json200({
    data: messages.map((message) => ({ status: 'ok', id: `ticket:${message.to}` })),
  })

function pushChannel(
  options: {
    url?: string | null
    userIds?: string[]
    tokens?: ModerationOpsPushTokens
    accessToken?: string | null
    send?: (messages: PushMessage[], call: number) => Response | Promise<Response>
    onAccepted?: ModerationOpsPushAccepted
    timeoutMs?: number
  } = {}
) {
  let sendCalls = 0
  const fetchSpy = vi.fn<typeof fetch>(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (urlOf(input) !== EXPO_SEND) return new Response('{}')
      sendCalls += 1
      const messages = JSON.parse(init!.body as string) as PushMessage[]
      return (options.send ?? acceptAll)(messages, sendCalls)
    }
  )
  const tokens = vi.fn<ModerationOpsPushTokens>(
    options.tokens ?? (() => Promise.resolve([...DEVICES]))
  )
  const onAccepted = vi.fn<ModerationOpsPushAccepted>(
    options.onAccepted ?? (() => Promise.resolve())
  )
  const channel = createModerationOpsChannel({
    url: options.url,
    fetch: fetchSpy,
    timeoutMs: options.timeoutMs,
    push: {
      userIds: options.userIds ?? MODERATORS,
      tokens,
      accessToken: options.accessToken,
      onAccepted,
    },
  })
  const sendRequests = () =>
    fetchSpy.mock.calls.filter(([url]) => urlOf(url) === EXPO_SEND)
  return { channel, fetchSpy, tokens, onAccepted, sendRequests }
}

const bodyOf = (call: Parameters<typeof fetch>) =>
  JSON.parse(call[1]!.body as string) as unknown
const LOCK_SCREEN = (to: string) => ({
  to,
  title: 'Moderation needs attention',
  body: 'Open the moderation console to review the queue.',
  priority: 'high',
  sound: 'default',
  channelId: 'community',
  data: { version: 1, source: 'moderation_sla' },
})

describe('U-CH-PUSH-CONFIG: the webhook wins, then push, then the console', () => {
  it('a webhook URL wins over moderator ids: the webhook gets the payload and no token is read', async () => {
    const { channel, fetchSpy, tokens } = pushChannel({
      url: 'https://hooks.example.test/x',
    })
    expect(channel.kind).toBe('webhook')
    await expect(channel.deliver(payload)).resolves.toBe('delivered')
    expect(tokens).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://hooks.example.test/x')
    expect(bodyOf(fetchSpy.mock.calls[0]!)).toEqual(payload)
  })

  it('a refused webhook URL still wins: invalid_config, with no push and no token read', async () => {
    const { channel, fetchSpy, tokens } = pushChannel({ url: 'http://example.test/x' })
    expect(channel.kind).toBe('webhook')
    await expect(channel.deliver(payload)).resolves.toBe('invalid_config')
    expect(tokens).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([[undefined], [null], [''], ['  ']])(
    'url %j with moderator ids means the push channel',
    (url) => {
      expect(pushChannel({ url: url as string }).channel.kind).toBe('push')
    }
  )

  it('no moderator ids means the console channel: invalid_config, no token read, no request', async () => {
    const { channel, fetchSpy, tokens } = pushChannel({ userIds: [] })
    expect(channel.kind).toBe('console')
    await expect(channel.deliver(payload)).resolves.toBe('invalid_config')
    expect(tokens).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('U-CH-PUSH-REQUEST: one generic message per granted device', () => {
  it('asks for the named moderators and POSTs every device in one request', async () => {
    const { channel, sendRequests, tokens } = pushChannel()
    await expect(channel.deliver(payload)).resolves.toBe('delivered')
    expect(tokens).toHaveBeenCalledTimes(1)
    expect(tokens).toHaveBeenCalledWith(MODERATORS)
    expect(sendRequests()).toHaveLength(1)
    const [url, init] = sendRequests()[0]!
    expect(url).toBe(EXPO_SEND)
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' })
    expect(init!.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init!.headers).get('content-type')).toBe('application/json')
    expect(bodyOf(sendRequests()[0]!)).toEqual(DEVICES.map(LOCK_SCREEN))
  })

  it('names no case: every alert kind and the drill send the same bytes, with no case data', async () => {
    const drill: ModerationSlaDrillPayload = {
      id: 'drill-1',
      kind: 'drill',
      detectedAt: '2026-11-19T12:00:00.000Z',
      text: 'Moderation SLA drill: no case is affected.',
    }
    const payloads = [
      ...(['at_risk', 'breached', 'escalated'] as const).map((kind) =>
        buildModerationSlaPayload({ ...alert, kind }, { appUrl: 'https://example.test' })
      ),
      drill,
    ]
    const raws: string[] = []
    for (const sent of payloads) {
      const { channel, sendRequests } = pushChannel({
        tokens: () => Promise.resolve([DEVICES[0]!]),
      })
      await expect(channel.deliver(sent)).resolves.toBe('delivered')
      raws.push(sendRequests()[0]![1]!.body as string)
    }
    expect(new Set(raws).size).toBe(1)
    expect(JSON.parse(raws[0]!)).toEqual([LOCK_SCREEN(DEVICES[0]!)])
    for (const leak of [
      payload.text,
      payload.casePath,
      payload.caseUrl!,
      'post.abc',
      'clx1',
      'drill-1',
      'high risk',
      'example.test',
      'breached',
    ]) {
      expect(raws[0], leak).not.toContain(leak)
    }
  })

  it('times out at 5000 ms by default, and an injected timeout replaces it', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      await pushChannel().channel.deliver(payload)
      expect(timeout).toHaveBeenLastCalledWith(5_000)
      await pushChannel({ timeoutMs: 50 }).channel.deliver(payload)
      expect(timeout).toHaveBeenLastCalledWith(50)
    } finally {
      timeout.mockRestore()
    }
  })
})

describe('U-CH-PUSH-BATCH: at most 100 messages per Expo request', () => {
  it.each([
    [100, [100]],
    [101, [100, 1]],
    [250, [100, 100, 50]],
  ])('%d devices go out as batches of %j, in order', async (count, sizes) => {
    const devices = Array.from({ length: count }, (_unused, index) => device(index))
    const { channel, sendRequests } = pushChannel({
      tokens: () => Promise.resolve(devices),
    })
    await expect(channel.deliver(payload)).resolves.toBe('delivered')
    const batches = sendRequests().map((call) => bodyOf(call) as PushMessage[])
    expect(batches.map((batch) => batch.length)).toEqual(sizes)
    expect(batches.flat()).toEqual(devices.map(LOCK_SCREEN))
  })

  it('a failed first batch never hides an accepted second one', async () => {
    const devices = Array.from({ length: 150 }, (_unused, index) => device(index))
    const { channel, sendRequests } = pushChannel({
      tokens: () => Promise.resolve(devices),
      send: (messages, call) => (call === 1 ? json200({}, 503) : acceptAll(messages)),
    })
    await expect(channel.deliver(payload)).resolves.toBe('delivered')
    expect(sendRequests()).toHaveLength(2)
  })

  it('an accepted first batch survives a second batch that throws', async () => {
    const devices = Array.from({ length: 150 }, (_unused, index) => device(index))
    const { channel } = pushChannel({
      tokens: () => Promise.resolve(devices),
      send: (messages, call) =>
        call === 1 ? acceptAll(messages) : Promise.reject(new TypeError('fetch failed')),
    })
    await expect(channel.deliver(payload)).resolves.toBe('delivered')
  })

  it.each([
    ['a 503 then a throw', 'http_5xx', 503, 'throw'],
    ['a throw then a 503', 'network', 'throw', 503],
    ['a 302 then a 500', 'http_3xx', 302, 500],
  ] as const)(
    'when every batch fails (%s), the first transport failure, %s, is the outcome',
    async (_name, outcome, first, second) => {
      const devices = Array.from({ length: 150 }, (_unused, index) => device(index))
      const answer = (how: number | 'throw') =>
        how === 'throw'
          ? Promise.reject(new TypeError('fetch failed'))
          : Promise.resolve(json200({}, how))
      const { channel, sendRequests } = pushChannel({
        tokens: () => Promise.resolve(devices),
        send: (_messages, call) => answer(call === 1 ? first : second),
      })
      await expect(channel.deliver(payload)).resolves.toBe(outcome)
      expect(sendRequests()).toHaveLength(2)
    }
  )

  it('a transport failure outranks configuration errors in another batch', async () => {
    const devices = Array.from({ length: 150 }, (_unused, index) => device(index))
    const { channel } = pushChannel({
      tokens: () => Promise.resolve(devices),
      send: (messages, call) =>
        call === 1
          ? json200({ data: messages.map(() => errorTicket('DeviceNotRegistered')) })
          : json200({}, 500),
    })
    await expect(channel.deliver(payload)).resolves.toBe('http_5xx')
  })
})

describe('U-CH-PUSH-AUTH: the Expo access token', () => {
  it('sends it as a bearer, and keeps it off the channel object and the outcome', async () => {
    const pushed = pushChannel({ accessToken: 'CANARYEXPOTOKEN' })
    const outcome = await pushed.channel.deliver(payload)
    expect(outcome).toBe('delivered')
    expect(new Headers(pushed.sendRequests()[0]![1]!.headers).get('authorization')).toBe(
      'Bearer CANARYEXPOTOKEN'
    )
    expect(JSON.stringify(pushed.channel)).not.toContain('CANARYEXPOTOKEN')
  })

  it.each([[undefined], [null], ['']])(
    'access token %j sends no Authorization header',
    async (accessToken) => {
      const { channel, sendRequests } = pushChannel({
        accessToken: accessToken as string,
      })
      await channel.deliver(payload)
      expect(new Headers(sendRequests()[0]![1]!.headers).has('authorization')).toBe(false)
    }
  )
})

describe('U-CH-PUSH-OUTCOMES: Expo tickets and failures map to the closed codes', () => {
  const ok = { status: 'ok', id: 'ticket-1' }
  it.each([
    [
      'one ok ticket after an error',
      'delivered',
      [errorTicket('MessageRateExceeded'), ok],
    ],
    [
      'one ok ticket before an error',
      'delivered',
      [ok, errorTicket('DeviceNotRegistered')],
    ],
    ['an ok ticket with no id', 'http_4xx', [{ status: 'ok' }]],
    ['an ok ticket with an empty id', 'http_4xx', [{ status: 'ok', id: '' }]],
    ['an ok ticket with a numeric id', 'http_4xx', [{ status: 'ok', id: 7 }]],
    ['DeviceNotRegistered only', 'invalid_config', [errorTicket('DeviceNotRegistered')]],
    ['InvalidCredentials only', 'invalid_config', [errorTicket('InvalidCredentials')]],
    ['MismatchSenderId only', 'invalid_config', [errorTicket('MismatchSenderId')]],
    [
      'every configuration error mixed',
      'invalid_config',
      [
        errorTicket('DeviceNotRegistered'),
        errorTicket('InvalidCredentials'),
        errorTicket('MismatchSenderId'),
      ],
    ],
    [
      'a configuration error beside another error',
      'http_4xx',
      [errorTicket('DeviceNotRegistered'), errorTicket('MessageRateExceeded')],
    ],
    ['MessageTooBig only', 'http_4xx', [errorTicket('MessageTooBig')]],
    ['an error ticket with no details', 'http_4xx', [{ status: 'error', message: 'x' }]],
    ['no tickets', 'http_4xx', []],
    ['tickets that are not objects', 'http_4xx', [null, 'ok', 3]],
  ])('%s gives %s', async (_name, outcome, tickets) => {
    const { channel } = pushChannel({ send: () => json200({ data: tickets }) })
    await expect(channel.deliver(payload)).resolves.toBe(outcome)
  })

  it.each([
    ['no data key', {}],
    ['data that is not a list', { data: { status: 'ok', id: 'x' } }],
  ])('a 200 with %s gives http_4xx', async (_name, body) => {
    const { channel } = pushChannel({ send: () => json200(body) })
    await expect(channel.deliver(payload)).resolves.toBe('http_4xx')
  })

  it('a 200 whose body is not JSON gives network', async () => {
    const { channel } = pushChannel({
      send: () => new Response('<html>', { status: 200 }),
    })
    await expect(channel.deliver(payload)).resolves.toBe('network')
  })

  it('a body read that times out gives timeout', async () => {
    const slowBody = {
      ok: true,
      status: 200,
      body: null,
      json: () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
    } as unknown as Response
    const { channel } = pushChannel({ send: () => slowBody })
    await expect(channel.deliver(payload)).resolves.toBe('timeout')
  })

  it.each([
    [302, 'http_3xx'],
    [400, 'http_4xx'],
    [429, 'http_4xx'],
    [500, 'http_5xx'],
    [503, 'http_5xx'],
  ])(
    'Expo status %d gives %s, even with an ok ticket in the body',
    async (status, outcome) => {
      const { channel } = pushChannel({ send: () => json200({ data: [ok] }, status) })
      await expect(channel.deliver(payload)).resolves.toBe(outcome)
    }
  )

  it.each([
    ['AbortError', new DOMException('aborted', 'AbortError'), 'timeout'],
    ['TimeoutError', new DOMException('timed out', 'TimeoutError'), 'timeout'],
    ['TypeError', new TypeError('fetch failed'), 'network'],
    ['a plain Error', new Error('boom'), 'network'],
  ])(
    'a fetch that throws %s gives %s and does not reject',
    async (_name, thrown, code) => {
      const { channel } = pushChannel({ send: () => Promise.reject(thrown as Error) })
      await expect(channel.deliver(payload)).resolves.toBe(code)
    }
  )

  it('no granted device gives invalid_config and sends nothing', async () => {
    const { channel, fetchSpy, tokens } = pushChannel({
      tokens: () => Promise.resolve([]),
    })
    await expect(channel.deliver(payload)).resolves.toBe('invalid_config')
    expect(tokens).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a token read that throws gives network, sends nothing and does not reject', async () => {
    const { channel, fetchSpy } = pushChannel({
      tokens: () => Promise.reject(new Error('database unreachable')),
    })
    await expect(channel.deliver(payload)).resolves.toBe('network')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('U-CH-PUSH-ACCEPTED: the accepted ticket ids reach onAccepted before delivered', () => {
  it('passes the alert id and every accepted ticket id, across batches, without the refused ones', async () => {
    // 150 devices make two Expo batches (100 and 50). Devices 3, 53 and 103 are refused, so both
    // batches hold accepted and refused tickets, and 147 accepted ids pass the 100 of one batch.
    const devices = Array.from({ length: 150 }, (_unused, index) => device(index))
    const refused = new Set([3, 53, 103].map((index) => devices[index]))
    const { channel, onAccepted, sendRequests } = pushChannel({
      tokens: () => Promise.resolve(devices),
      send: (messages) =>
        json200({
          data: messages.map((message) =>
            refused.has(message.to)
              ? errorTicket('DeviceNotRegistered')
              : { status: 'ok', id: `ticket:${message.to}` }
          ),
        }),
    })
    await expect(channel.deliver(payload)).resolves.toBe('delivered')
    expect(sendRequests().map((call) => (bodyOf(call) as unknown[]).length)).toEqual([
      100, 50,
    ])
    expect(onAccepted).toHaveBeenCalledTimes(1)
    const expected = devices.filter((d) => !refused.has(d)).map((d) => `ticket:${d}`)
    expect(expected).toHaveLength(147)
    expect(onAccepted).toHaveBeenCalledWith('clx1', expected)
  })

  it('does not resolve delivered until onAccepted has finished', async () => {
    let finish!: () => void
    const recorded = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { channel, onAccepted } = pushChannel({ onAccepted: () => recorded })
    let settled = false
    const outcome = channel.deliver(payload).then((value) => {
      settled = true
      return value
    })
    await vi.waitFor(() => {
      expect(onAccepted).toHaveBeenCalledTimes(1)
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    finish()
    await expect(outcome).resolves.toBe('delivered')
  })

  // Expo accepted the push, so a failed ticket write must not turn into a resend: `deliver` never
  // rejects. The sweep composition logs the failed write (I-W-PUSH-RESTART in
  // integration/moderation-sla-push.integration.spec.ts).
  it.each([
    [
      'returns a rejected promise',
      () => Promise.reject(new Error('ticket write failed')),
    ],
    [
      'throws before returning a promise',
      (): Promise<void> => {
        throw new Error('ticket write failed')
      },
    ],
  ])(
    'resolves delivered when onAccepted %s, after Expo accepted the push',
    async (_name, failing) => {
      const onAccepted = vi.fn(failing)
      const { channel, sendRequests } = pushChannel({ onAccepted })
      await expect(channel.deliver(payload)).resolves.toBe('delivered')
      expect(onAccepted).toHaveBeenCalledTimes(1)
      expect(sendRequests()).toHaveLength(1)
    }
  )

  it.each([
    [
      'every ticket refused',
      () => json200({ data: [errorTicket('DeviceNotRegistered')] }),
    ],
    ['a 500', () => json200({}, 500)],
  ])('is not called when nothing was accepted: %s', async (_name, answer) => {
    const { channel, onAccepted } = pushChannel({ send: answer })
    await expect(channel.deliver(payload)).resolves.not.toBe('delivered')
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('is not called by the webhook channel', async () => {
    const { channel, onAccepted } = pushChannel({ url: 'https://hooks.example.test/x' })
    await expect(channel.deliver(payload)).resolves.toBe('delivered')
    expect(onAccepted).not.toHaveBeenCalled()
  })
})

describe('U-CH-RECEIPTS-READ: readExpoPushReceipts', () => {
  const ids = (count: number) => Array.from({ length: count }, (_u, index) => `t${index}`)
  /** Answers every lookup with an ok receipt for each id asked. */
  const receiptsFetch = (
    answer: (asked: string[], call: number) => Response | Promise<Response> = (asked) =>
      json200({ data: Object.fromEntries(asked.map((id) => [id, { status: 'ok' }])) })
  ) => {
    let calls = 0
    return vi.fn<typeof fetch>((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      const asked = (JSON.parse(init!.body as string) as { ids: string[] }).ids
      return Promise.resolve(answer(asked, calls))
    })
  }

  it('POSTs the ids to the receipts endpoint with the bearer, following no redirect', async () => {
    const send = receiptsFetch()
    await readExpoPushReceipts(['t1', 't2'], { send, accessToken: 'CANARYEXPOTOKEN' })
    expect(send).toHaveBeenCalledTimes(1)
    const [url, init] = send.mock.calls[0]!
    expect(url).toBe(EXPO_RECEIPTS)
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' })
    expect(init!.signal).toBeInstanceOf(AbortSignal)
    const headers = new Headers(init!.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('authorization')).toBe('Bearer CANARYEXPOTOKEN')
    expect(JSON.parse(init!.body as string)).toEqual({ ids: ['t1', 't2'] })
  })

  it('sends no Authorization header without an access token', async () => {
    const send = receiptsFetch()
    await readExpoPushReceipts(['t1'], { send })
    expect(new Headers(send.mock.calls[0]![1]!.headers).has('authorization')).toBe(false)
  })

  it.each([
    [1000, [1000]],
    [1001, [1000, 1]],
    [2500, [1000, 1000, 500]],
  ])('%d ids go out as lookups of %j, in order', async (count, sizes) => {
    const send = receiptsFetch()
    const all = ids(count)
    const receipts = await readExpoPushReceipts(all, { send })
    const lookups = send.mock.calls.map(
      ([, init]) => (JSON.parse(init!.body as string) as { ids: string[] }).ids
    )
    expect(lookups.map((lookup) => lookup.length)).toEqual(sizes)
    expect(lookups.flat()).toEqual(all)
    expect(receipts.size).toBe(count)
  })

  it('no ids sends nothing and returns an empty map', async () => {
    const send = receiptsFetch()
    await expect(readExpoPushReceipts([], { send })).resolves.toEqual(new Map())
    expect(send).not.toHaveBeenCalled()
  })

  it('maps ok, error with its code, error with no code, and leaves out what it cannot read', async () => {
    const send = receiptsFetch(() =>
      json200({
        data: {
          ok1: { status: 'ok', id: 'ok1' },
          dead: errorTicket('DeviceNotRegistered'),
          bare: { status: 'error', message: 'x' },
          odd: { status: 'pending' },
          nil: null,
        },
      })
    )
    const receipts = await readExpoPushReceipts(
      ['ok1', 'dead', 'bare', 'odd', 'nil', 'none'],
      {
        send,
      }
    )
    expect(Object.fromEntries(receipts)).toEqual({
      ok1: { status: 'ok' },
      dead: { status: 'error', error: 'DeviceNotRegistered' },
      bare: { status: 'error', error: 'unknown_error' },
    })
  })

  it.each([
    [500, 'receipt lookup answered 500'],
    [429, 'receipt lookup answered 429'],
    [302, 'receipt lookup answered 302'],
  ])('a %d throws, so the caller retries', async (status, message) => {
    const send = receiptsFetch(() => json200({ data: {} }, status))
    await expect(readExpoPushReceipts(['t1'], { send })).rejects.toThrow(message)
  })

  it.each([
    ['no data key', {}],
    ['null data', { data: null }],
    ['string data', { data: 'nope' }],
  ])('%s throws receipt lookup returned no data', async (_name, body) => {
    const send = receiptsFetch(() => json200(body))
    await expect(readExpoPushReceipts(['t1'], { send })).rejects.toThrow(
      'receipt lookup returned no data'
    )
  })

  it('a second lookup that fails throws, even after a good first lookup', async () => {
    const send = receiptsFetch((asked, call) =>
      call === 1
        ? json200({ data: Object.fromEntries(asked.map((id) => [id, { status: 'ok' }])) })
        : json200({}, 503)
    )
    await expect(readExpoPushReceipts(ids(1001), { send })).rejects.toThrow(
      'receipt lookup answered 503'
    )
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('a fetch that throws propagates', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')))
    await expect(readExpoPushReceipts(['t1'], { send })).rejects.toThrow('fetch failed')
  })

  it('times out at 5000 ms by default, and an injected timeout replaces it', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      await readExpoPushReceipts(['t1'], { send: receiptsFetch() })
      expect(timeout).toHaveBeenLastCalledWith(5_000)
      await readExpoPushReceipts(['t1'], { send: receiptsFetch(), timeoutMs: 50 })
      expect(timeout).toHaveBeenLastCalledWith(50)
    } finally {
      timeout.mockRestore()
    }
  })
})

describe('U-CH-PUSH-IDS: parseModerationOpsPushUserIds', () => {
  it.each([
    ['commas', 'mod-1,mod-2', ['mod-1', 'mod-2']],
    ['spaces', 'mod-1 mod-2', ['mod-1', 'mod-2']],
    [
      'commas and whitespace mixed',
      ' mod-1, mod-2 ,mod-3\tmod-4\nmod-5 ',
      ['mod-1', 'mod-2', 'mod-3', 'mod-4', 'mod-5'],
    ],
    ['empty entries between commas', 'mod-1,,, mod-2,', ['mod-1', 'mod-2']],
    ['duplicates, first position kept', 'mod-2,mod-1 mod-2,mod-1', ['mod-2', 'mod-1']],
    ['one id', 'mod-1', ['mod-1']],
    ['empty', '', []],
    ['blank', ' \t\n ', []],
    ['only separators', ', ,', []],
    ['undefined', undefined, []],
    ['null', null, []],
  ])('%s', (_name, raw, ids) => {
    expect(parseModerationOpsPushUserIds(raw)).toEqual(ids)
  })
})
