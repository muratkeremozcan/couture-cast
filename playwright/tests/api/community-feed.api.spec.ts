// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
//
// WHY THE DELIBERATE ERROR ROWS LIVE HERE AND NOT IN THE BROWSER SPEC.
// `merged-fixtures.ts` composes `networkErrorMonitor`, which fails a test when the
// page issues a request that comes back failing. Every row below drives a 400, a
// 404, a 409 or a 429 on purpose, so running them through the browser would trip
// that monitor or force it to be disabled, and a disabled monitor stops catching
// the unexpected failures it exists for. `merged-fixtures.ts:47-53` records the
// Story 4.4 round of this argument.
//
// Two journeys are deliberately absent because both need a post visible in the
// public feed, and both are written up in `playwright/tests/community-feed.spec.ts`:
// anything reading the public feed, and the self-report 403. A self-report against
// an author's own `pending_review` post returns 404, not 403, because the report
// path resolves visibility before ownership.
import {
  encodeCommunityFeedCursor,
  type ClimateBand,
  type CommunityFeedMode,
} from '@couture/api-client/contracts/http'
import {
  assertSeededFeed,
  communityApiTest as test,
  expect,
  SEEDED_COMMUNITY_POSTS,
} from '../../support/helpers/community-session'

const FEED_PATH = '/api/v1/community/feed'

/** A published seeded post, so it is reportable. */
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

/**
 * The ten keys `communityFeedItemSchema` declares. `user_id` and
 * `image_object_path` are the two the story forbids by name; an exact set catches
 * those and anything else not allowlisted.
 */
const FEED_ITEM_KEYS = [
  'altText',
  'author',
  'caption',
  'challengeId',
  'climateBand',
  'createdAt',
  'id',
  'imageAccess',
  'publishedAt',
  'status',
]

type CommunityFeedItemShape = {
  id: string
  climateBand: string | null
  caption: string | null
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
     * THE RAW BODY, and that is the point of this assertion. The generated client's
     * `FromJSON` copies only the fields its model declares, so an extra field the
     * API served would be discarded before any assertion could see it; Pact's
     * response matching treats the expected body as a subset, so an extra key
     * verifies clean there too (`pact/http/consumer/interactions/community.ts` says
     * so in place). This is the tier where "the server sends exactly the
     * allowlisted projection" can be proven.
     */
    const body = (await response.json()) as {
      data: Record<string, unknown> & { items: Record<string, unknown>[] }
    }
    expect(Object.keys(body)).toEqual(['data'])
    expect(Object.keys(body.data).sort()).toEqual(FEED_ENVELOPE_KEYS)
    expect(body.data.mode).toBe('all')

    /*
     * THE ENVELOPE IS NOT THE PROJECTION. The keys above describe the wrapper;
     * the leak this test exists to catch would be inside an ITEM, and over an
     * empty feed the assertions above pass without a single row being looked at.
     * `assertSeededFeed` existed for this and had zero call sites in the
     * repository, so the delegation the Pact interaction makes to "the tier where
     * non-leakage can be proven" pointed at an assertion that was never written.
     *
     * The floor comes first so an unseeded database fails naming `npm run db:seed`
     * rather than passing vacuously.
     */
    assertSeededFeed(body.data.items as unknown as CommunityFeedItemShape[])
    expect(body.data.items.length).toBeGreaterThan(0)

    /*
     * Every item, not just the first: a projection that leaked on one row and not
     * another would slip past a spot check. `user_id` and `image_object_path` are
     * the two the story forbids by name, and an exact key set catches them and
     * anything else that has not been allowlisted.
     */
    for (const item of body.data.items) {
      expect(Object.keys(item).sort()).toEqual(FEED_ITEM_KEYS)
      expect(Object.keys(item.author as Record<string, unknown>).sort()).toEqual([
        'displayName',
        'isSelf',
      ])
    }
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
     * THIS TEST ASKS THE API WHICH MODE IT SERVED. The beta experiment assignment
     * is stable per viewer and SELECTS the effective mode: `resolveEffectiveMode`
     * is `requestedMode === 'auto' ? variant : requestedMode`, so a request for
     * `auto` is served whichever arm that user id hashes into, and the cursor is
     * bound to what was SERVED. An earlier version of this test hardcoded a cursor
     * stamped `all` and expected a mismatch against `auto`. For a caller in the
     * `all` arm that cursor now MATCHES and the request succeeds, and
     * `communityApiTest` signs up a fresh account per test, so the arm is redrawn
     * every run: a coin flip.
     *
     * WHAT A GREEN RUN HERE DOES AND DOES NOT PROVE. A single pass would look
     * identical under the old hardcoded cursor if the account happened to draw the
     * `auto` arm, so the run is evidence only in combination with the structure
     * below: the probe cursor is stamped with whichever arm was NOT served, so the
     * mismatch cannot depend on the draw. If someone later simplifies this back to
     * a fixed `mode` literal, it will pass roughly half the time and that half will
     * look like a green suite.
     *
     * So page one is fetched purely to learn the effective mode, and the cursor is
     * then stamped with the OTHER value. Pinning a fixture that hashes into a
     * convenient arm would pass today and silently stop testing anything the moment
     * the assignment secret rotates.
     */
    const servedPage = await request.get(
      `${communityApi.apiBaseUrl}${FEED_PATH}?mode=auto&limit=1`,
      { headers: communityApi.headers }
    )
    expect(servedPage.status()).toBe(200)
    const servedBody = (await servedPage.json()) as {
      data: { mode: string; viewerBand: ClimateBand | null }
    }
    const servedMode = servedBody.data.mode
    const servedBand = servedBody.data.viewerBand
    /*
     * The two arms ARE `auto` and `all`, so `auto` surviving as the effective
     * mode is normal and an earlier version of this comment claiming otherwise
     * was simply wrong. What this guard is for is narrower: `resolveEffectiveMode`
     * must resolve a requested `auto` to an ARM, never to a band literal, because
     * `foreignMode` below is derived by flipping between exactly these two values
     * and would stop being foreign if a third could appear.
     */
    expect(['auto', 'all']).toContain(servedMode)
    const foreignMode: CommunityFeedMode = servedMode === 'all' ? 'auto' : 'all'

    /*
     * MINTED THROUGH THE CONTRACT'S OWN ENCODER, not hand-rolled JSON, and that
     * is load-bearing rather than tidy. `communityFeedCursorPayloadSchema` is
     * `.strict()`, and the cursor now has THREE rejection paths that all return
     * the identical message: a schema parse failure, a mode mismatch, and a band
     * mismatch. A hand-built payload that omits a newly required field therefore
     * still produces the 400 this test expects — via the schema path — and the
     * test goes on passing while no longer exercising mode binding at all.
     * That is not hypothetical: `band` was added to the payload and this test
     * kept passing for the wrong reason until it was caught by reading the
     * schema. `encodeCommunityFeedCursor` parses before it encodes, so a future
     * required field breaks the typecheck instead.
     *
     * `band` is set to what the SERVER will compare against, so the mode is the
     * only thing that mismatches. The comparison is
     * `parseCursor(cursor, effectiveMode, filterBand ?? null)`, and `filterBand`
     * is null when the effective mode is `all` and the viewer band otherwise.
     */
    const expectedBand = servedMode === 'all' ? null : servedBand
    const cursor = encodeCommunityFeedCursor({
      publishedAt: '2026-01-01T00:04:00.000Z',
      id: SEEDED_POST_ID,
      mode: foreignMode,
      band: expectedBand,
    })

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
     * 404 is the contract here, and it is the stronger answer: distinguishing
     * "exists but is not yours" from "does not exist" would let any caller probe
     * for the existence of another member's unpublished posts.
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
      // The draft allocated below belongs to THIS account, so the teardown has to
      // be told about it or the row outlives the run.
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
     * A REPLAY OF THE SAME REASON IS 200. Someone who taps report twice has done
     * nothing wrong, and an earlier draft of this contract contradicted itself on
     * this point.
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
     * The ORIGINAL session comes back. A new row here would strand the first
     * upload, the failure the idempotency key exists to prevent for a client that
     * lost the response to a dropped connection.
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
