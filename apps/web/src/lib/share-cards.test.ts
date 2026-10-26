import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { ResponseError } from '@couture/api-client'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import { useMswHandlers } from '../test-utils/msw/runtime'
import {
  downloadShareCard,
  prepareShareCardFromWeb,
  shareCardErrorKey,
  validateWebShareCard,
} from './share-cards'
const createObjectURL = vi.fn(() => 'blob:approved')
const revokeObjectURL = vi.fn()
const input = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  purpose: 'preview',
  locale: 'en-US',
  watermark: true,
} as const
beforeEach(() => {
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
    http.post('http://localhost:3001/api/v1/share-cards/prepare', () =>
      HttpResponse.json({ data: card })
    )
  )
})
describe('web share-card immutable download boundary', () => {
  it('U-WEB-SAVE: authenticates, validates the original preview and rejects corrupted digest', async () => {
    expect(await prepareShareCardFromWeb(input, new AbortController().signal)).toEqual(
      card
    )
    await expect(
      validateWebShareCard({ ...card, sha256: 'f'.repeat(64) })
    ).rejects.toThrow('invalid_png')
  })
  it('U-OFFLINE: refuses cached-source export before requesting; canceled preparation never returns bytes', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await expect(
      prepareShareCardFromWeb(input, new AbortController().signal)
    ).rejects.toThrow('offline')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const abort = new AbortController()
    abort.abort()
    await expect(prepareShareCardFromWeb(input, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
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
})
