// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '../src/generated'
import {
  SHARE_CARD_CAPABILITIES_DEADLINE_MS,
  shareCardsClient,
} from '../src/share-cards-client'
import { preparedShareCardFixture as card } from '../src/testing/share-card-fixture'
const input = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
} as const
const unused = () => Promise.reject(new Error('not under test'))
afterEach(() => {
  vi.useRealTimers()
})
describe('deadline-aware share-card client', () => {
  it('validates contract input/output around the generated operation', async () => {
    const prepareShareCard = vi.fn(() => Promise.resolve({ data: card }))
    const client = shareCardsClient({
      prepareShareCard,
      getShareCardCapabilities: unused,
    })
    expect(await client.prepare(input)).toEqual(card)
    expect(prepareShareCard).toHaveBeenCalledWith(
      { prepareShareCardRequest: input },
      { signal: expect.any(AbortSignal) as AbortSignal }
    )
  })
  it('U-SHARE-CONTRACT: sends a share reauthorization with its digest', async () => {
    const prepareShareCard = vi.fn(() => Promise.resolve({ data: card }))
    const share = { ...input, purpose: 'share', expectedSha256: card.sha256 } as const
    await shareCardsClient({
      prepareShareCard,
      getShareCardCapabilities: unused,
    }).prepare(share)
    expect(prepareShareCard).toHaveBeenCalledWith(
      { prepareShareCardRequest: share },
      { signal: expect.any(AbortSignal) as AbortSignal }
    )
  })
  it('U-CANCEL: late response after cancellation cannot become a preview', async () => {
    const abort = new AbortController()
    const client = shareCardsClient({
      prepareShareCard: () => {
        abort.abort()
        return Promise.resolve({ data: card })
      },
      getShareCardCapabilities: unused,
    })
    await expect(client.prepare(input, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('U-SHARE-CAP-CLIENT: capabilities read', () => {
  const capabilities = (
    getShareCardCapabilities: Parameters<
      typeof shareCardsClient
    >[0]['getShareCardCapabilities']
  ) => shareCardsClient({ prepareShareCard: unused, getShareCardCapabilities })
  const off = { nativeShare: false }

  it.each([true, false])('reads nativeShare %s from the strict envelope', async (on) => {
    const getShareCardCapabilities = vi.fn(() =>
      Promise.resolve({ data: { nativeShare: on } })
    )
    await expect(capabilities(getShareCardCapabilities).capabilities()).resolves.toEqual({
      nativeShare: on,
    })
    expect(getShareCardCapabilities).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal) as AbortSignal,
    })
  })

  it.each([
    ['404 from a pre-6.9 server', 404],
    ['5xx', 503],
    ['401', 401],
  ])('treats %s as off', async (_name, status) => {
    const failure = new ResponseError(new Response(null, { status }), 'failed')
    await expect(
      capabilities(() => Promise.reject(failure)).capabilities()
    ).resolves.toEqual(off)
  })

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['malformed JSON', () => Promise.reject(new SyntaxError('Unexpected token <'))],
    [
      'a synchronous throw',
      () => {
        throw new Error('broken transport')
      },
    ],
  ])('treats %s as off', async (_name, read) => {
    await expect(
      capabilities(read as () => Promise<never>).capabilities()
    ).resolves.toEqual(off)
  })

  it.each([
    ['missing data', {}],
    ['null data', { data: null }],
    ['missing nativeShare', { data: {} }],
    ['string nativeShare', { data: { nativeShare: 'true' } }],
    ['numeric nativeShare', { data: { nativeShare: 1 } }],
    ['an extra field', { data: { nativeShare: true, tier: 'beta' } }],
    ['an extra envelope field', { data: { nativeShare: true }, meta: {} }],
    ['a null body', null],
    ['a string body', 'true'],
  ])('treats %s as off', async (_name, body) => {
    await expect(
      capabilities(() => Promise.resolve(body as never)).capabilities()
    ).resolves.toEqual(off)
  })

  it('gives up after 5 s, aborts the request and resolves off', async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const pending = capabilities((init) => {
      seen = (init as RequestInit).signal ?? undefined
      return new Promise(() => undefined)
    }).capabilities()
    let settled: unknown
    void pending.then((value) => {
      settled = value
    })
    await vi.advanceTimersByTimeAsync(SHARE_CARD_CAPABILITIES_DEADLINE_MS - 1)
    expect(settled).toBeUndefined()
    expect(seen?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toEqual(off)
    expect(seen?.aborted).toBe(true)
    expect(SHARE_CARD_CAPABILITIES_DEADLINE_MS).toBe(5000)
  })

  it('a caller abort mid-request resolves off and a late true is ignored', async () => {
    const abort = new AbortController()
    let answer!: (value: { data: { nativeShare: boolean } }) => void
    const pending = capabilities(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    ).capabilities(abort.signal)
    abort.abort()
    answer({ data: { nativeShare: true } })
    await expect(pending).resolves.toEqual(off)
  })

  it('a response that lands after the abort fired still reads off', async () => {
    const abort = new AbortController()
    await expect(
      capabilities(() => {
        abort.abort()
        return Promise.resolve({ data: { nativeShare: true } })
      }).capabilities(abort.signal)
    ).resolves.toEqual(off)
  })

  it('an already aborted caller never sends the request', async () => {
    const abort = new AbortController()
    abort.abort()
    const read = vi.fn(() => Promise.resolve({ data: { nativeShare: true } }))
    await expect(capabilities(read).capabilities(abort.signal)).resolves.toEqual(off)
    expect(read).not.toHaveBeenCalled()
  })
})
