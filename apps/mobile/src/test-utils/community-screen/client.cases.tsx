/* eslint-disable @typescript-eslint/await-thenable */
import { imagePicker, FEED_ROUTE, item, feed, errorEnvelope } from './harness'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
} from '@couture/api-client/contracts/http'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { server } from '@/src/test-utils/msw/server'
import {
  CommunityRequestError,
  communityFailureReason,
  communityRetryAfterSeconds,
  getCommunityFeedFromMobile,
  getCommunityPostFromMobile,
  pickCommunityPhoto,
  reportCommunityPostFromMobile,
} from '@/src/lib/community'

export function registerCommunityClientCases() {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(() => {
    const apiBaseUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', apiBaseUrl)
    process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  async function feedReason(response: Response): Promise<string> {
    server.use(http.get(FEED_ROUTE, () => response))
    try {
      await getCommunityFeedFromMobile({ mode: 'auto' })
    } catch (error: unknown) {
      return communityFailureReason(error)
    }
    throw new Error('expected the feed read to reject')
  }

  it('6.1-MOB-023 refuses to call the API with no session', async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    let called = false
    server.use(
      http.get(FEED_ROUTE, () => {
        called = true
        return HttpResponse.json({ data: feed() })
      })
    )

    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      reason: 'signed_out',
    })
    expect(called).toBe(false)
  })

  it.each([
    // `community.service.ts` answers this 400 whenever a cursor no longer matches
    // the mode or the resolved band it was minted under; the screen restarts
    // paging on it, which it can only do if it arrives as its own reason.
    [400, COMMUNITY_CURSOR_INVALID_MESSAGE, 'cursor_invalid'],
    [400, 'Some other bad request.', 'unknown'],
    [401, 'Unauthorized', 'signed_out'],
    [403, COMMUNITY_AGE_GATE_DENIED_MESSAGE, 'age_gate'],
    // The service refuses a self-report with a ForbiddenException, so this
    // belongs to 403 and not to 409; classifying it as a conflict left
    // `community.error.selfReport` unreachable in production.
    [403, COMMUNITY_SELF_REPORT_MESSAGE, 'self_report'],
    [403, 'Forbidden for another reason.', 'unknown'],
    [404, 'Community post not found.', 'not_found'],
    [409, COMMUNITY_REPORT_REASON_CHANGED_MESSAGE, 'reason_changed'],
    // A message the client does not recognise falls back to generic translated
    // copy rather than surfacing the server's untranslated English.
    [409, 'Some other conflict.', 'unknown'],
    [429, 'Slow down.', 'rate_limited'],
    [503, COMMUNITY_FEED_DISABLED_MESSAGE, 'disabled'],
    // A published row whose object cannot be signed. The service answers this on
    // the single-post read and on publish, and it shares its status with the
    // rollout kill switch, so the two are told apart by message alone.
    [503, COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE, 'media_unavailable'],
    [503, 'Down for maintenance.', 'unknown'],
    [500, 'Internal server error.', 'unknown'],
  ])('6.1-MOB-024 classifies HTTP %s "%s" as %s', async (status, message, reason) => {
    expect(await feedReason(errorEnvelope(status, message))).toBe(reason)
  })

  it('6.1-MOB-025 falls back to its own wording when the error body carries no message', async () => {
    server.use(
      http.get(FEED_ROUTE, () => new HttpResponse('<html>502</html>', { status: 502 }))
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      reason: 'unknown',
      message: 'Unable to load the community feed.',
    })

    server.use(
      http.get(FEED_ROUTE, () =>
        HttpResponse.json({ statusCode: 502, error: 'Bad Gateway' }, { status: 502 })
      )
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      message: 'Unable to load the community feed.',
    })

    server.use(
      http.get(FEED_ROUTE, () =>
        HttpResponse.json({ statusCode: 502, message: '   ' }, { status: 502 })
      )
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      message: 'Unable to load the community feed.',
    })
  })

  it('6.1-MOB-026 keeps Retry-After only when it parses as delta-seconds', async () => {
    server.use(
      http.get(FEED_ROUTE, () =>
        errorEnvelope(429, 'Slow down.', { 'Retry-After': '120' })
      )
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      retryAfterSeconds: 120,
    })

    server.use(
      http.get(FEED_ROUTE, () =>
        errorEnvelope(429, 'Slow down.', {
          'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT',
        })
      )
    )
    await expect(getCommunityFeedFromMobile({ mode: 'auto' })).rejects.toMatchObject({
      retryAfterSeconds: undefined,
    })
    expect(communityRetryAfterSeconds(new Error('not ours'))).toBeUndefined()
    expect(communityFailureReason(new Error('not ours'))).toBe('unknown')
  })

  it('6.1-MOB-027 reads one post and reports 404 for anything the caller cannot see', async () => {
    server.use(
      http.get('*/api/v1/community/posts/:postId', ({ params }) =>
        params.postId === 'post-a'
          ? HttpResponse.json({ data: item() })
          : errorEnvelope(404, 'Community post not found.')
      )
    )

    await expect(getCommunityPostFromMobile('post-a')).resolves.toMatchObject({
      id: 'post-a',
    })
    await expect(getCommunityPostFromMobile('post-z')).rejects.toMatchObject({
      reason: 'not_found',
    })
  })

  it('6.1-MOB-028 surfaces a transport failure as an unknown reason', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/report', () => HttpResponse.error())
    )

    await expect(reportCommunityPostFromMobile('post-a', 'spam')).rejects.toBeInstanceOf(
      CommunityRequestError
    )
  })

  it('6.1-MOB-029 classifies a denied or failed photo picker rather than leaking a native error', async () => {
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })
    await expect(pickCommunityPhoto()).rejects.toMatchObject({
      reason: 'permission_denied',
    })

    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.launchImageLibraryAsync.mockRejectedValue(new Error('picker exploded'))
    await expect(pickCommunityPhoto()).rejects.toMatchObject({
      reason: 'picker_failed',
      message: 'picker exploded',
    })

    // A native module can reject with something that is not an Error at all.
    imagePicker.launchImageLibraryAsync.mockRejectedValue('exploded')
    await expect(pickCommunityPhoto()).rejects.toMatchObject({
      reason: 'picker_failed',
      message: 'Image picker failed to open.',
    })

    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    })
    await expect(pickCommunityPhoto()).resolves.toBeNull()

    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo.jpg', width: 900, height: 1200 }],
    })
    await expect(pickCommunityPhoto()).resolves.toEqual({
      uri: 'file:///photo.jpg',
      width: 900,
      height: 1200,
    })
  })
}
