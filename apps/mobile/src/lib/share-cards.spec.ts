import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import { server } from '../test-utils/msw/server'
import { setMobileAccessTokenResolver } from './mobile-auth'
import { prepareShareCardFromMobile } from './share-cards'
const fixture = vi.hoisted(() => ({ mode: 'real' }))
vi.mock('./share-card-native-fixture', () => ({
  shareCardFixtureMode: () => fixture.mode,
  waitShareCardNativePreparation: () => Promise.resolve(),
}))
const input = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
} as const
const endpoint = 'http://localhost:4000/api/v1/share-cards/prepare'
beforeEach(() => {
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'http://localhost:4000')
  process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:4000'
  fixture.mode = 'real'
  setMobileAccessTokenResolver(() => 'owned-session')
  server.use(
    http.post(endpoint, ({ request }) => {
      expect(request.headers.get('Authorization')).toBe('Bearer owned-session')
      return HttpResponse.json({ data: card })
    })
  )
})
describe('mobile approved byte transport', () => {
  it('U-SAVE: uses canonical authenticated SDK and validates exact decoded digest', async () => {
    expect(await prepareShareCardFromMobile(input, new AbortController().signal)).toEqual(
      card
    )
  })
  it('U-MEDIA: response digest mismatch never reaches preview', async () => {
    server.use(
      http.post(endpoint, () =>
        HttpResponse.json({ data: { ...card, sha256: 'f'.repeat(64) } })
      )
    )
    await expect(
      prepareShareCardFromMobile(input, new AbortController().signal)
    ).rejects.toThrow('render')
  })
  it('U-OFFLINE: isolated offline boundary refuses preparation', async () => {
    fixture.mode = 'offline'
    await expect(
      prepareShareCardFromMobile(input, new AbortController().signal)
    ).rejects.toThrow('offline')
  })
  it('U-CANCEL: an aborted caller receives no approved bytes', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(prepareShareCardFromMobile(input, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
  it('U-IDENTITY: signed-out transport cannot fabricate an actor token', async () => {
    setMobileAccessTokenResolver(() => undefined)
    server.use(
      http.post(endpoint, ({ request }) => {
        expect(request.headers.has('Authorization')).toBe(false)
        return new HttpResponse(null, { status: 401 })
      })
    )
    await expect(
      prepareShareCardFromMobile(input, new AbortController().signal)
    ).rejects.toMatchObject({ response: { status: 401 } })
  })
  it('U-OFFLINE: real SDK fetch rejection maps to closed offline feedback', async () => {
    server.use(http.post(endpoint, () => HttpResponse.error()))
    await expect(
      prepareShareCardFromMobile(input, new AbortController().signal)
    ).rejects.toThrow('offline')
  })
  it('U-OFFLINE: HTTP service failures retain status semantics', async () => {
    server.use(http.post(endpoint, () => new HttpResponse(null, { status: 503 })))
    await expect(
      prepareShareCardFromMobile(input, new AbortController().signal)
    ).rejects.toMatchObject({ response: { status: 503 } })
  })
})
