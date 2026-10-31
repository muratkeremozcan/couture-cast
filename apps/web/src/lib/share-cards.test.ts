// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
import { createHash, webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { ResponseError, shareCardSharedEventSchema } from '@couture/api-client'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { currentI18n } from '../i18n'
import { browserAnalytics } from '../analytics/browser-analytics'
import {
  SHARE_CARD_FILE_NAME,
  authorizeShareCardFile,
  canShareCardFiles,
  captureShareCardShared,
  downloadShareCard,
  handOffShareCardFile,
  prepareShareCardFromWeb,
  shareCardCapabilitiesFromWeb,
  shareCardErrorKey,
  shareCardFile,
  validateWebShareCard,
} from './share-cards'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
const createObjectURL = vi.fn(() => 'blob:approved')
const revokeObjectURL = vi.fn()
const input = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  purpose: 'preview',
  locale: 'en-US',
  watermark: true,
} as const
const authorizations: (string | null)[] = []
beforeEach(() => {
  authorizations.length = 0
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'member-bearer')
  vi.stubGlobal('crypto', webcrypto)
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001')
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL.mockReset().mockReturnValue('blob:approved'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL.mockReset(),
  })
  useMswHandlers(
    http.post('http://localhost:3001/api/v1/share-cards/prepare', ({ request }) => {
      authorizations.push(request.headers.get('authorization'))
      return HttpResponse.json({ data: card })
    })
  )
})
describe('web share-card immutable download boundary', () => {
  it('U-WEB-SAVE: authenticates, validates the original preview and rejects corrupted digest', async () => {
    expect(await prepareShareCardFromWeb(input, new AbortController().signal)).toEqual(
      card
    )
    expect(authorizations).toEqual(['Bearer member-bearer'])
    await expect(
      validateWebShareCard({ ...card, sha256: 'f'.repeat(64) })
    ).rejects.toThrow('invalid_png')
  })
  it('U-OFFLINE: refuses cached-source export before requesting; canceled preparation never returns bytes', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await expect(
      prepareShareCardFromWeb(input, new AbortController().signal)
    ).rejects.toThrow('offline')
    expect(authorizations).toEqual([])
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const abort = new AbortController()
    abort.abort()
    await expect(prepareShareCardFromWeb(input, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(authorizations).toEqual([])
  })
  it.each([
    [409, 'previewChanged'],
    [401, 'sourceUnavailable'],
    [403, 'sourceUnavailable'],
    [404, 'sourceUnavailable'],
    [503, 'render'],
    [500, 'unknown'],
  ] as const)(
    'classifies closed HTTP%d error without private server text',
    (status, expected) => {
      expect(
        shareCardErrorKey(
          new ResponseError(new Response('private source URL', { status }))
        )
      ).toBe(expected)
    }
  )
  it('classifies offline and unknown values with closed labels', () => {
    expect(shareCardErrorKey(new Error('offline'))).toBe('offline')
    expect(shareCardErrorKey(new Error('private path'))).toBe('unknown')
    expect(shareCardErrorKey(null)).toBe('unknown')
  })
  it('U-WEB-SAVE P-DOWNLOAD-ERROR: observable handoff rejection removes the anchor and revokes its bounded URL', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
        throw new Error('handoff_failure')
      })
      await expect(downloadShareCard(card, new AbortController().signal)).rejects.toThrow(
        'handoff_failure'
      )
      expect(document.querySelector('a[download]')).toBeNull()
      expect(revokeObjectURL).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:approved')
    } finally {
      vi.useRealTimers()
    }
  })
  it('U-CANCEL: cancellation before URL creation and immediately before click prevents handoff', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const abort = new AbortController()
    abort.abort()
    await expect(downloadShareCard(card, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(createObjectURL).not.toHaveBeenCalled()
    const during = new AbortController()
    createObjectURL.mockImplementation(() => {
      during.abort()
      return 'blob:approved'
    })
    await expect(downloadShareCard(card, during.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(click).not.toHaveBeenCalled()
  })
  it('U-WEB-SAVE P-CANCEL: cancellation after the Blob URL exists still revokes it within the bound', async () => {
    vi.useFakeTimers()
    try {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined)
      const during = new AbortController()
      createObjectURL.mockImplementation(() => {
        during.abort()
        return 'blob:cancelled'
      })
      await expect(downloadShareCard(card, during.signal)).rejects.toMatchObject({
        name: 'AbortError',
      })
      expect(click).not.toHaveBeenCalled()
      expect(document.querySelector('a[download]')).toBeNull()
      expect(revokeObjectURL).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:cancelled')
    } finally {
      vi.useRealTimers()
    }
  })
})

const shareInput = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  locale: 'en-US',
  watermark: true,
  expectedSha256: card.sha256,
} as const
const digestOf = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    // jsdom's Blob has no arrayBuffer(); FileReader reads the same bytes.
    const reader = new FileReader()
    reader.onload = () =>
      resolve(
        createHash('sha256')
          .update(new Uint8Array(reader.result as ArrayBuffer))
          .digest('hex')
      )
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsArrayBuffer(file)
  })
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
// A valid card with different bytes: the fixture plus one more IDAT chunk before IEND.
function differentCard() {
  const original = Buffer.from(card.pngBase64, 'base64')
  const body = Buffer.from([0x49, 0x44, 0x41, 0x54, 0])
  const chunk = Buffer.alloc(4 + body.length + 4)
  chunk.writeUInt32BE(1, 0)
  body.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(body), 4 + body.length)
  const bytes = Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)])
  return {
    ...card,
    pngBase64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
const stubShare = (values: { canShare?: unknown; share?: unknown }) => {
  for (const [name, value] of Object.entries(values))
    Object.defineProperty(navigator, name, { configurable: true, value })
}
const removeShare = () => {
  Reflect.deleteProperty(navigator, 'canShare')
  Reflect.deleteProperty(navigator, 'share')
}
describe('web share-card Web Share boundary', () => {
  it('U-WEB-SHARE-LIB: reauthorizes with purpose share and returns a File of the previewed bytes', async () => {
    const bodies: unknown[] = []
    useMswHandlers(
      http.post(
        'http://localhost:3001/api/v1/share-cards/prepare',
        async ({ request }) => {
          bodies.push(await request.json())
          return HttpResponse.json({ data: card })
        }
      )
    )
    const file = await authorizeShareCardFile(shareInput, new AbortController().signal)
    expect(bodies).toEqual([{ ...shareInput, purpose: 'share' }])
    expect(file.name).toBe('couturecast-card.png')
    expect(SHARE_CARD_FILE_NAME).toBe(file.name)
    expect(file.type).toBe('image/png')
    expect(await digestOf(file)).toBe(card.sha256)
  })
  it('U-WEB-SHARE-LIB: a response for different bytes reads as a changed preview and a corrupted digest is refused', async () => {
    const other = differentCard()
    expect(other.sha256).not.toBe(card.sha256)
    useMswHandlers(
      http.post('http://localhost:3001/api/v1/share-cards/prepare', () =>
        HttpResponse.json({ data: other })
      )
    )
    const changed = await authorizeShareCardFile(
      shareInput,
      new AbortController().signal
    ).catch((error: unknown) => error)
    expect(shareCardErrorKey(changed)).toBe('previewChanged')
    useMswHandlers(
      http.post('http://localhost:3001/api/v1/share-cards/prepare', () =>
        HttpResponse.json({ data: { ...other, sha256: card.sha256 } })
      )
    )
    await expect(
      authorizeShareCardFile(shareInput, new AbortController().signal)
    ).rejects.toThrow('invalid_png')
  })
  it('U-WEB-SHARE-LIB: a share 403 or offline settles as a closed failure label before any handoff', async () => {
    useMswHandlers(
      http.post('http://localhost:3001/api/v1/share-cards/prepare', () =>
        HttpResponse.json({ code: 'share_disabled' }, { status: 403 })
      )
    )
    const forbidden = await authorizeShareCardFile(
      shareInput,
      new AbortController().signal
    ).catch((error: unknown) => error)
    expect(forbidden).toBeInstanceOf(ResponseError)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await expect(
      authorizeShareCardFile(shareInput, new AbortController().signal)
    ).rejects.toThrow('offline')
    const abort = new AbortController()
    abort.abort()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await expect(authorizeShareCardFile(shareInput, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
  it('U-WEB-SHARE-LIB: missing, false or throwing canShare means unsupported', () => {
    try {
      removeShare()
      expect(canShareCardFiles()).toBe(false)
      const share = vi.fn()
      stubShare({ canShare: () => false, share })
      expect(canShareCardFiles()).toBe(false)
      stubShare({
        canShare: () => {
          throw new TypeError('blocked')
        },
      })
      expect(canShareCardFiles()).toBe(false)
      stubShare({ canShare: () => 'yes' })
      expect(canShareCardFiles()).toBe(false)
      const canShare = vi.fn(() => true)
      stubShare({ canShare })
      expect(canShareCardFiles()).toBe(true)
      const [[asked]] = canShare.mock.calls as unknown as [[{ files: File[] }]]
      expect(asked.files).toHaveLength(1)
      expect(asked.files[0]).toMatchObject({
        name: SHARE_CARD_FILE_NAME,
        type: 'image/png',
      })
      stubShare({ share: undefined })
      expect(canShareCardFiles()).toBe(false)
    } finally {
      removeShare()
    }
  })
  it.each([
    ['resolves', () => Promise.resolve(), { outcome: 'handed_off', target: 'unknown' }],
    [
      'AbortError',
      () => Promise.reject(new DOMException('closed', 'AbortError')),
      { outcome: 'dismissed', target: 'none' },
    ],
    [
      'NotAllowedError',
      () => Promise.reject(new DOMException('no activation', 'NotAllowedError')),
      { outcome: 'failed', target: 'none', code: 'activation_expired' },
    ],
    [
      'DataError',
      () => Promise.reject(new DOMException('bad file', 'DataError')),
      { outcome: 'failed', target: 'none', code: 'share_error' },
    ],
    [
      'a synchronous throw',
      () => {
        throw new TypeError('not supported')
      },
      { outcome: 'failed', target: 'none', code: 'share_error' },
    ],
    [
      'a SecurityError',
      () => Promise.reject(new DOMException('blocked', 'SecurityError')),
      { outcome: 'failed', target: 'none', code: 'share_error' },
    ],
  ] as const)(
    'U-WEB-SHARE-LIB: share %s maps onto the result model',
    async (_, share, expected) => {
      const file = shareCardFile(Buffer.from(card.pngBase64, 'base64'))
      const spy = vi.fn(share)
      stubShare({ share: spy })
      try {
        const pending = handOffShareCardFile(file)
        // The call happens before the function returns, so no await precedes it.
        expect(spy).toHaveBeenCalledExactlyOnceWith({ files: [file] })
        expect(await pending).toEqual(expected)
      } finally {
        removeShare()
      }
    }
  )
  it('U-WEB-SHARE-LIB: capabilities read on and fall back to off', async () => {
    useMswHandlers(
      http.get('http://localhost:3001/api/v1/share-cards/capabilities', ({ request }) => {
        authorizations.push(request.headers.get('authorization'))
        return HttpResponse.json({ data: { nativeShare: true } })
      })
    )
    expect(await shareCardCapabilitiesFromWeb(new AbortController().signal)).toEqual({
      nativeShare: true,
    })
    expect(authorizations).toEqual(['Bearer member-bearer'])
    useMswHandlers(
      http.get('http://localhost:3001/api/v1/share-cards/capabilities', () =>
        HttpResponse.json({ code: 'not_found' }, { status: 404 })
      )
    )
    expect(await shareCardCapabilitiesFromWeb(new AbortController().signal)).toEqual({
      nativeShare: false,
    })
  })
  it('U-WEB-SHARE-LIB: one capture holds only the four business keys and the locale, and analytics failures are swallowed', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1500.4)
    const capture = vi
      .spyOn(browserAnalytics, 'capture')
      .mockImplementation(() => undefined)
    await currentI18n().changeLanguage('pt-BR')
    captureShareCardShared({ outcome: 'handed_off', target: 'unknown' }, 250)
    expect(capture).toHaveBeenCalledExactlyOnceWith('share_card_shared', {
      client: 'web',
      target: 'unknown',
      outcome: 'handed_off',
      duration_ms: 1250,
      locale: 'pt-BR',
    })
    // The business keys alone still pass the strict four-key schema.
    const { locale, ...business } = capture.mock.calls[0]![1] as Record<string, unknown>
    expect(locale).toBe('pt-BR')
    expect(shareCardSharedEventSchema.safeParse(business).success).toBe(true)
    // A language outside the catalog falls back to the default supported locale.
    await currentI18n().changeLanguage('xx')
    captureShareCardShared(
      { outcome: 'failed', target: 'none', code: 'activation_expired' },
      -86_400_000
    )
    await currentI18n().changeLanguage('en-US')
    expect(capture.mock.calls[1]![1]).toEqual({
      client: 'web',
      target: 'none',
      outcome: 'failed',
      duration_ms: 86_400_000,
      locale: 'en-US',
    })
    captureShareCardShared({ outcome: 'dismissed', target: 'none' }, 9_999)
    expect(capture.mock.calls[2]![1]).toMatchObject({ duration_ms: 0 })
    capture.mockImplementation(() => {
      throw new Error('analytics_down')
    })
    expect(() =>
      captureShareCardShared({ outcome: 'dismissed', target: 'none' }, 0)
    ).not.toThrow()
    const rejected = Promise.reject(new Error('analytics_rejected'))
    const caught = vi.spyOn(rejected, 'catch')
    capture.mockImplementation(() => rejected as unknown as void)
    expect(() =>
      captureShareCardShared({ outcome: 'dismissed', target: 'none' }, 0)
    ).not.toThrow()
    expect(caught).toHaveBeenCalledOnce()
  })
})
