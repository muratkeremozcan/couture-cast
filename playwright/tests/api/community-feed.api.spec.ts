// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
// Story 6.1 Task 6: the community HTTP surface against the real running API.
//
// WHY THE DELIBERATE ERROR ROWS LIVE HERE RATHER THAN IN THE BROWSER SPEC.
// `merged-fixtures.ts` composes `networkErrorMonitor`, which fails a test when the
// page issues a request that comes back failing. Every row below drives a 400, a
// 404, a 409 or a 429 on purpose, so running them through the browser would either
// trip that monitor or force it to be disabled — and a disabled monitor is worse
// than the coverage it was protecting, because it stops catching the unexpected
// failures it exists for. `merged-fixtures.ts:47-53` records the Story 4.4 round of
// exactly this argument.
//
// WHAT THIS FILE CAN AND CANNOT REACH. Everything asserted below was verified
// against a real local API before it was written. Two journeys are deliberately
// absent because they are BLOCKED rather than skipped, and both are written up in
// `playwright/tests/community-feed.spec.ts`:
//   - anything requiring a post to appear in the public feed;
//   - the self-report 403, which needs the caller's own post to be visible, and
//     therefore published, which is what the blockers prevent.
// A self-report against an author's own `pending_review` post returns 404, not
// 403, because the report path resolves visibility before ownership.
import {
  communityApiTest as test,
  expect,
  SEEDED_COMMUNITY_POSTS,
} from '../../support/helpers/community-session'

const FEED_PATH = '/api/v1/community/feed'

/** A published seeded post: reportable, which is all these rows need it to be. */
const SEEDED_POST_ID = SEEDED_COMMUNITY_POSTS[0].id

/** Not a real id in any shape the API mints, so it can only ever be a 404. */
const MISSING_POST_ID = 'community-post-that-does-not-exist'

const ALLOCATE_BODY = {
  locale: 'en-US',
  contentType: 'image/jpeg',
  byteSize: 123_456,
  sha256: 'd2c8a3f16b0e47a95c3d81f0b6e27a4c9d5e0f3a1b7c8d9e0f1a2b3c4d5e6f70',
  widthPx: 1080,
  heightPx: 1350,
}

/** The nine keys `communityFeedSchema` declares, and no others. */
const FEED_ENVELOPE_KEYS = [
  'activeChallenge',
  'authorStates',
  'bandResolved',
  'bandUnresolvedReason',
  'experimentVariant',
  'items',
  'mode',
  'nextCursor',
  'viewerBand',
]

test.describe('6.1 community feed HTTP contract', () => {
  test('6.1-API-01 serves the documented feed envelope and nothing beyond it', async ({
    request,
    communityApi,
  }) => {
    const response = await request.get(
      `${communityApi.apiBaseUrl}${FEED_PATH}?mode=all&limit=12`,
      { headers: communityApi.headers }
    )

    expect(response.status()).toBe(200)

    /*
     * THE RAW BODY, not an SDK-decoded object, and that distinction is the whole
     * point of this assertion. The generated client's `FromJSON` copies only the
     * fields its model declares, so a field the API actually served would be
     * discarded before any assertion could see it; and Pact's response matching
     * treats the expected body as a subset, so an extra key verifies clean there
     * too. `pact/http/consumer/interactions/community.ts` says so in place. This
     * is the tier where "the server sends exactly the allowlisted projection"
     * can actually be proven, so it is proven here.
     */
    const body = (await response.json()) as { data: Record<string, unknown> }
    expect(Object.keys(body)).toEqual(['data'])
    expect(Object.keys(body.data).sort()).toEqual(FEED_ENVELOPE_KEYS)
    expect(body.data.mode).toBe('all')
  })

  test('6.1-API-02 rejects a mode the enum does not define', async ({
    request,
    communityApi,
  }) => {
    const response = await request.get(
      `${communityApi.apiBaseUrl}${FEED_PATH}?mode=blizzard`,
      { headers: communityApi.headers }
    )

    expect(response.status()).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('Bad Request')
  })

  test('6.1-API-03 rejects a malformed cursor with the stable message', async ({
    request,
    communityApi,
  }) => {
    const response = await request.get(
      `${communityApi.apiBaseUrl}${FEED_PATH}?mode=auto&cursor=not-a-base64url-cursor`,
      { headers: communityApi.headers }
    )

    expect(response.status()).toBe(400)
    const body = (await response.json()) as { message: string; error: string }
    expect(body.message).toBe('Invalid pagination cursor.')
    expect(body.error).toBe('Bad Request')
  })

  test('6.1-API-04 rejects a well-formed cursor presented under another mode', async ({
    request,
    communityApi,
  }) => {
    /*
     * THE SERVED MODE IS ASKED FOR, NOT ASSUMED, and that is the whole point of
     * this arrangement.
     *
     * The beta experiment assignment is stable per viewer and now SELECTS the
     * effective mode: `resolveEffectiveMode` is
     * `requestedMode === 'auto' ? variant : requestedMode`, so a request for
     * `auto` is served whichever arm that user id hashes into, and the cursor is
     * bound to what was SERVED rather than what was asked for. An earlier
     * version of this test hardcoded a cursor stamped `all` and expected a
     * mismatch against `auto`. For a caller in the `all` arm that cursor now
     * MATCHES and the request succeeds, and since `communityApiTest` signs up a
     * fresh account per test the arm is redrawn every run — a coin flip, not a
     * stable failure.
     *
     * WHAT A GREEN RUN HERE DOES AND DOES NOT PROVE. A single pass would look
     * identical under the old hardcoded cursor if the account happened to draw
     * the `auto` arm, so the run is evidence only in combination with the
     * structure below: the probe cursor is stamped with whichever arm was NOT
     * served, so the mismatch cannot depend on the draw. If someone later
     * simplifies this back to a fixed `mode` literal, it will pass roughly half
     * the time and that half will look like a green suite.
     *
     * So page one is fetched first purely to learn the effective mode, and the
     * cursor is then stamped with the OTHER value. The mismatch is guaranteed
     * for either arm, and the test never depends on which one it drew. Pinning a
     * fixture that hashes into a convenient arm would pass today and silently
     * stop testing anything the moment the assignment secret rotates.
     */
    const servedPage = await request.get(
      `${communityApi.apiBaseUrl}${FEED_PATH}?mode=auto&limit=1`,
      { headers: communityApi.headers }
    )
    expect(servedPage.status()).toBe(200)
    const servedMode = ((await servedPage.json()) as { data: { mode: string } }).data.mode
    // `auto` is never the EFFECTIVE mode: it always resolves to one arm or the
    // other. If that stops being true this assertion says so rather than the
    // mismatch below quietly becoming a match.
    expect(['auto', 'all']).toContain(servedMode)
    const foreignMode = servedMode === 'all' ? 'auto' : 'all'

    const cursor = Buffer.from(
      JSON.stringify({
        publishedAt: '2026-01-01T00:04:00.000Z',
        id: SEEDED_POST_ID,
        mode: foreignMode,
      }),
      'utf8'
    ).toString('base64url')

    const response = await request.get(
      `${communityApi.apiBaseUrl}${FEED_PATH}?mode=auto&cursor=${cursor}`,
      { headers: communityApi.headers }
    )

    expect(response.status()).toBe(400)
    const body = (await response.json()) as { message: string }
    // THE SAME message a malformed cursor produces, deliberately: a client that
    // changed filters must not be able to tell the two apart, because its only
    // correct move in either case is to restart paging.
    expect(body.message).toBe('Invalid pagination cursor.')
  })

  test('6.1-API-05 answers 404 for a post id that does not exist', async ({
    request,
    communityApi,
  }) => {
    const response = await request.get(
      `${communityApi.apiBaseUrl}/api/v1/community/posts/${MISSING_POST_ID}`,
      { headers: communityApi.headers }
    )

    expect(response.status()).toBe(404)
    const body = (await response.json()) as { message: string; error: string }
    expect(body.message).toBe('Community post not found.')
    expect(body.error).toBe('Not Found')
  })

  test('6.1-API-06 hides another author draft behind the same 404', async ({
    request,
    communityApi,
    playwright,
  }) => {
    /*
     * The cross-user boundary, driven with two real accounts rather than asserted
     * from the schema. The second account allocates — which creates a `draft` row
     * it owns — and the first account asks for it by id.
     *
     * 404 rather than 403 is the contract, and it is the stronger answer:
     * distinguishing "exists but is not yours" from "does not exist" would let
     * any caller probe for the existence of another member's unpublished posts.
     */
    const other = await playwright.request.newContext()
    try {
      const signup = await other.post(`${communityApi.apiBaseUrl}/api/v1/auth/signup`, {
        data: {
          email: `community-other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
          birthdate: '1995-01-01',
        },
      })
      expect(signup.status()).toBe(201)
      const otherUserId = ((await signup.json()) as { userId: string }).userId
      // The draft allocated below belongs to THIS account, not to the fixture's,
      // so the teardown has to be told about it or the row outlives the run.
      communityApi.trackUser(otherUserId)

      const allocate = await other.post(
        `${communityApi.apiBaseUrl}/api/v1/community/posts/allocate`,
        {
          headers: {
            Authorization: `Bearer test-token:guardian:${otherUserId}`,
            'x-couture-platform': 'web',
            'Idempotency-Key': crypto.randomUUID(),
          },
          data: ALLOCATE_BODY,
        }
      )
      expect(allocate.status()).toBe(200)
      const otherPostId = ((await allocate.json()) as { data: { postId: string } }).data
        .postId

      const response = await request.get(
        `${communityApi.apiBaseUrl}/api/v1/community/posts/${otherPostId}`,
        { headers: communityApi.headers }
      )

      expect(response.status()).toBe(404)
      const body = (await response.json()) as { message: string }
      expect(body.message).toBe('Community post not found.')
    } finally {
      await other.dispose()
    }
  })

  test('6.1-API-07 replays a same-reason report and conflicts on a changed one', async ({
    request,
    communityApi,
  }) => {
    const reportUrl = `${communityApi.apiBaseUrl}/api/v1/community/posts/${SEEDED_POST_ID}/report`

    const first = await request.post(reportUrl, {
      headers: communityApi.headers,
      data: { reason: 'spam' },
    })
    expect(first.status()).toBe(200)
    // The reporter learns nothing about the moderation outcome, by design.
    expect(await first.json()).toEqual({ tracked: true })

    /*
     * A REPLAY OF THE SAME REASON IS 200, not a conflict. Someone who taps report
     * twice has not done anything wrong, and the earlier draft of this contract
     * contradicted itself on exactly this point.
     */
    const replay = await request.post(reportUrl, {
      headers: communityApi.headers,
      data: { reason: 'spam' },
    })
    expect(replay.status()).toBe(200)
    expect(await replay.json()).toEqual({ tracked: true })

    /*
     * A CHANGED reason is a conflict, because the stored report is the record a
     * moderator acts on and silently rewriting it would rewrite that record.
     */
    const changed = await request.post(reportUrl, {
      headers: communityApi.headers,
      data: { reason: 'harassment' },
    })
    expect(changed.status()).toBe(409)
    const body = (await changed.json()) as { message: string; error: string }
    expect(body.message).toBe('You already reported this post for a different reason.')
    expect(body.error).toBe('Conflict')
  })

  test('6.1-API-08 answers 404 when reporting a post the caller cannot see', async ({
    request,
    communityApi,
  }) => {
    const response = await request.post(
      `${communityApi.apiBaseUrl}/api/v1/community/posts/${MISSING_POST_ID}/report`,
      { headers: communityApi.headers, data: { reason: 'spam' } }
    )

    expect(response.status()).toBe(404)
    const body = (await response.json()) as { message: string; error: string }
    expect(body.message).toBe('Community post not found.')
    expect(body.error).toBe('Not Found')
  })

  test('6.1-API-09 replays an allocation for the same key and payload', async ({
    request,
    communityApi,
  }) => {
    const idempotencyKey = crypto.randomUUID()
    const headers = { ...communityApi.headers, 'Idempotency-Key': idempotencyKey }
    const url = `${communityApi.apiBaseUrl}/api/v1/community/posts/allocate`

    const first = await request.post(url, { headers, data: ALLOCATE_BODY })
    expect(first.status()).toBe(200)
    const firstSession = (
      (await first.json()) as {
        data: { postId: string; uploadSessionId: string; altTextSuggestionLocale: string }
      }
    ).data

    // The suggestion comes back in the locale the caller asked for, so an author
    // is never asked to confirm alt text written in a language they did not pick.
    expect(firstSession.altTextSuggestionLocale).toBe('en-US')

    const replay = await request.post(url, { headers, data: ALLOCATE_BODY })
    expect(replay.status()).toBe(200)
    const replaySession = (
      (await replay.json()) as {
        data: { postId: string; uploadSessionId: string }
      }
    ).data

    /*
     * The ORIGINAL session, not a second one. A new row here would strand the
     * first upload, which is the whole failure the idempotency key exists to
     * prevent for a client that lost the response to a dropped connection.
     */
    expect(replaySession.postId).toBe(firstSession.postId)
    expect(replaySession.uploadSessionId).toBe(firstSession.uploadSessionId)
  })

  test('6.1-API-10 conflicts on an allocation key reused with different bytes', async ({
    request,
    communityApi,
  }) => {
    const idempotencyKey = crypto.randomUUID()
    const headers = { ...communityApi.headers, 'Idempotency-Key': idempotencyKey }
    const url = `${communityApi.apiBaseUrl}/api/v1/community/posts/allocate`

    const first = await request.post(url, { headers, data: ALLOCATE_BODY })
    expect(first.status()).toBe(200)

    const mismatched = await request.post(url, {
      headers,
      data: {
        ...ALLOCATE_BODY,
        byteSize: 999_001,
        sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      },
    })

    // The key is a promise about a payload. Serving the first session for
    // different bytes would silently publish the wrong image.
    expect(mismatched.status()).toBe(409)
    const body = (await mismatched.json()) as { error: string }
    expect(body.error).toBe('Conflict')
  })
})
