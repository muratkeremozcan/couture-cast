/*
 * Story 6.2 Task 8: end-to-end publication evidence.
 *
 * WHAT A GREEN RUN OF THIS FILE IS AND IS NOT EVIDENCE FOR. These journeys run
 * against whichever screener the launcher selected, and
 * `scripts/start-api-e2e-with-workers.mjs` prints that choice on startup. Under
 * the default fixture mode the image screener clears every image without
 * looking at the bytes, so a green safe journey is evidence about the HTTP,
 * storage, outbox, BullMQ, PostgreSQL and author-state path, and about nothing
 * whatsoever concerning image safety. `6.2-E2E-01` asserts the persisted engine
 * identity rather than trusting that distinction to a comment.
 *
 * The unsafe journey is refused by the TEXT screener, never the image screener.
 * No unsafe imagery exists in this repository and none may be added, so image
 * blocking is proved at the disposition-function level in the API workspace
 * instead. Read `6.2-E2E-02` as proof of non-publication and cross-user feed
 * absence, not as proof that the model detects anything.
 */
import { log } from '@seontechnologies/playwright-utils/log'
import type { APIRequestContext, TestInfo } from '@playwright/test'
import { authHeaders, buildUniqueId } from '../support/helpers/api-test'
import {
  communityApiTest,
  communityTest,
  expect,
  loadCommunityFixture,
  publishCommunityLook,
  signUpCommunityUser,
  waitForTerminalAuthorState,
  COMMUNITY_FEED_PATH,
  COMMUNITY_PUBLISH_PATH,
} from '../support/helpers/community-session'

const COMMUNITY_ROUTE = '/'

/**
 * The stable code `reasonCodes.text` in `policy-v1.json` gives a matched term,
 * and the only code a caption refusal may persist on its own. Restated here
 * because the Playwright project does not compile against the API workspace;
 * `6.2-E2E-02` fails by name if the policy ever renames it.
 */
const TEXT_POLICY_MATCH_REASON = 'text_policy_match'

/*
 * The highest-confidence entry in the v1 corpus, measured at Neutral 0.9991.
 *
 * THE BROWSER JOURNEY DOES NOT SCREEN THESE EXACT BYTES. `prepareGarmentImage`
 * centre-crops to 4:3 and re-encodes through a canvas before upload, so what
 * the model scores in 6.2-E2E-01 is a Chromium re-encode of a crop and its
 * hash is not the manifest hash. Starting from the widest-margin fixture is
 * what keeps that transformed image comfortably inside the pass branch once the
 * real model replaces the fixture. The API journey below uploads the raw bytes,
 * so the two journeys deliberately screen different images.
 */
const SAFE_FIXTURE = 'safe-satin-plum-512x512.jpg'

communityTest.describe('6.2 community publication journey', () => {
  communityTest.beforeEach(({ interceptNetworkCall }) => {
    void interceptNetworkCall({
      url: '**/api/v1/events/poll**',
      fulfillResponse: {
        status: 200,
        body: { events: [], nextSince: new Date(0).toISOString() },
      },
    })
  })

  /*
   * Raised above the 60s default. `waitForTerminalAuthorState` polls for up to
   * 60s on its own, and a real-model run adds a cold model start on top, so at
   * the default the test times out before the helper can report which state the
   * post was actually stuck in. The helper's diagnostic is the whole reason it
   * has a deadline of its own.
   */
  communityTest.setTimeout(180_000)

  communityTest(
    '6.2-E2E-01 publishes an uploaded look through the real screening pipeline',
    async ({ page, request, interceptNetworkCall, communitySession }) => {
      expect(communitySession.userId).toBeTruthy()
      const fixture = loadCommunityFixture(SAFE_FIXTURE)

      await page.goto(COMMUNITY_ROUTE)
      await page.getByTestId('create-post-button').click()

      /*
       * The web client allocates and PUTs the bytes on the file-input `change`
       * event, before the author has confirmed anything, so the upload is
       * already in flight here. `post-alt-text-input` only becomes populated
       * once that round trip resolves, which is why the wait is on the
       * suggestion rather than on the input existing.
       */
      await log.step('Choose the photo, which allocates and uploads it')
      await page.getByTestId('post-image-file-input').setInputFiles({
        name: fixture.path,
        mimeType: fixture.contentType,
        buffer: fixture.bytes,
      })
      await expect(page.getByTestId('post-image-preview')).toBeVisible()
      await expect(page.getByTestId('post-alt-text-input')).not.toHaveValue('')

      await log.step('Confirm the alt text and publish')
      await page.getByTestId('post-alt-text-input').fill('A plum satin wrap dress.')
      const confirmAltText = page.getByTestId('confirm-alt-text-checkbox')
      // Editing the alt text resets the confirmation, so it is checked after the
      // fill and never before it.
      await confirmAltText.check()
      await page.getByTestId('post-caption-input').fill('Evening layers for a mild night')

      const publishRequest = interceptNetworkCall({
        method: 'POST',
        url: `**${COMMUNITY_PUBLISH_PATH}`,
      })
      await page.getByTestId('post-publish-submit').click()
      const published = await publishRequest

      expect(published.status).toBe(200)
      const postId = (published.responseJson as { data: { id: string } }).data.id
      expect(postId).toBeTruthy()

      await expect(page.getByTestId('community-action-notice')).toHaveAttribute(
        'data-tone',
        'success'
      )

      /*
       * Waits on the API rather than on the page, because the moderation run is
       * asynchronous and the surface the author sees is a snapshot taken at
       * page load. Polling the DOM here would race the one-second local
       * dispatcher and reload for no reason.
       */
      await log.step('Wait for the moderation worker to reach a terminal state')
      const terminal = await waitForTerminalAuthorState(request, {
        apiBaseUrl: communitySession.apiBaseUrl,
        userId: communitySession.userId,
        postId,
      })

      expect(
        terminal.status,
        `Expected the safe fixture to publish. Terminal state was "${terminal.status}"` +
          `${terminal.moderationReason ? ` because "${terminal.moderationReason}"` : ''}.`
      ).toBe('published')

      /*
       * The claim this run is allowed to make, asserted rather than assumed. The
       * persisted identity is `<text engine>;<image engine>` and the image half
       * carries a `-fixture` suffix whenever the fixture screener produced it.
       * A run that quietly fell back to the fixture while reporting itself as a
       * real-model run is the single most damaging failure this story can have.
       */
      expect(terminal.engineVersion).toBeTruthy()
      const usedFixtureScreener = terminal.engineVersion?.includes('-fixture') ?? false
      const declaredRealModel =
        (process.env.COMMUNITY_SCREENING_EVIDENCE_MODE ?? '').trim().toLowerCase() ===
        'real-model'
      expect(
        usedFixtureScreener,
        `Persisted engine identity "${terminal.engineVersion}" disagrees with the ` +
          'screening path this run declared. Evidence mode was ' +
          `"${process.env.COMMUNITY_SCREENING_EVIDENCE_MODE ?? 'fixture'}".`
      ).toBe(!declaredRealModel)

      await log.step('The published look is visible to its author on the feed')
      await page.goto(COMMUNITY_ROUTE)
      await expect(page.getByTestId(`lookbook-card-${postId}`)).toBeVisible()
    }
  )
})

communityApiTest.describe('6.2 community non-publication journey', () => {
  communityApiTest(
    '6.2-E2E-02 refuses a disallowed caption and keeps it out of another member feed',
    async ({ request, communityApi }, testInfo) => {
      const fixture = loadCommunityFixture(SAFE_FIXTURE)

      /*
       * REFUSED BY THE TEXT SCREENER, WITH A SAFE IMAGE. The caption carries a
       * French profanity while the post declares `en-US`, which also pins the
       * rule that every dictionary runs against every submission: a
       * client-controlled locale must not be able to opt out of another
       * language's terms. If this test ever fails because the term stopped
       * matching, that is a real coverage regression and not a stale fixture.
       */
      const { postId } = await publishCommunityLook(request, {
        apiBaseUrl: communityApi.apiBaseUrl,
        userId: communityApi.userId,
        fixture,
        altText: 'A plum satin wrap dress.',
        caption: 'merde what a night',
        locale: 'en-US',
      })

      const terminal = await waitForTerminalAuthorState(request, {
        apiBaseUrl: communityApi.apiBaseUrl,
        userId: communityApi.userId,
        postId,
      })

      expect(
        terminal.status,
        'A caption carrying a disallowed term must never publish.'
      ).toBe('flagged')
      /*
       * THE SCREENER THAT REFUSED IT IS ASSERTED, NOT ASSUMED. Decision 7 lets
       * this journey stand in for an unsafe-image journey only if it is
       * labelled as a text refusal, and a truthy reason cannot tell the two
       * apart: a stack whose image screener fell back to `unavailable` refuses
       * every post with `screening_unavailable`, and this test would have gone
       * green on that refusal while the caption was never the cause. The
       * persisted reason is the joined list of every code that held the post,
       * so equality here also proves the safe image cleared.
       */
      expect(
        terminal.moderationReason,
        'The refusal must come from the text screener alone; any other code means the image half refused too and this journey no longer proves what it claims.'
      ).toBe(TEXT_POLICY_MATCH_REASON)

      await log.step('The refused look is absent from a second member feed')
      const otherUserId = await signUpSecondMember(request, communityApi, testInfo)
      const feedResponse = await request.get(
        `${communityApi.apiBaseUrl}${COMMUNITY_FEED_PATH}?mode=all`,
        {
          headers: {
            ...authHeaders(otherUserId, 'guardian'),
            'x-couture-platform': 'web',
          },
        }
      )
      expect(feedResponse.status()).toBe(200)
      const feed = (await feedResponse.json()) as {
        data: {
          items: { id: string }[]
          authorStates: { id: string }[]
        }
      }

      expect(
        feed.data.items.map((item) => item.id),
        'A flagged post must never reach another member feed.'
      ).not.toContain(postId)
      expect(
        feed.data.authorStates.map((state) => state.id),
        'Another member author-state list must never carry someone else post.'
      ).not.toContain(postId)

      /*
       * THE LEAK SURFACE IS THE AUTHOR'S OWN VIEW, NOT THE STRANGER'S. The
       * assertions above already established the flagged post is absent from the
       * second member's feed, so scanning that payload for a matched term proves
       * nothing: a feed with no post trivially carries no term. The author's own
       * `authorStates` entry is the one place the post genuinely appears
       * alongside a moderation reason, so that is where a raw term or a class
       * probability would actually escape.
       */
      const authorFeed = await request.get(
        `${communityApi.apiBaseUrl}${COMMUNITY_FEED_PATH}`,
        { headers: communityApi.headers }
      )
      expect(authorFeed.status()).toBe(200)
      const authorBody = (await authorFeed.json()) as {
        data: { authorStates: Record<string, unknown>[] }
      }
      const ownState = authorBody.data.authorStates.find(
        (state) => state.id === postId
      ) as (Record<string, unknown> & { moderationReason: string | null }) | undefined
      expect(
        ownState,
        'The author must still see their own refused post, otherwise this assertion scans nothing.'
      ).toBeDefined()

      /*
       * ASSERTED ON THE SHAPE, NOT BY SCANNING THE PAYLOAD FOR SUBSTRINGS. Two
       * earlier versions of this failed as false positives, and both were the
       * test's fault rather than the product's: the author's own caption is
       * echoed back to the author, which is not a leak, and their own
       * `imageAccess.url` is a signed URL their feed needs in order to render.
       * A substring scan is also flaky here, because `Porn` and `Sexy` are valid
       * base64url four-grams and a signed-URL signature can contain either by
       * chance.
       *
       * What AC 4 and AC 6 actually require is that the safety metadata carries
       * a stable code and nothing else, so the key set is the assertion and the
       * reason string is checked on its own.
       */
      expect(
        ownState && Object.keys(ownState).sort(),
        'The author state exposes a field outside the contract, which is how per-class scores would first escape.'
      ).toEqual(
        [
          'altText',
          'caption',
          'challengeId',
          'climateBand',
          'createdAt',
          'id',
          'imageAccess',
          'moderationReason',
          'publishedAt',
          'status',
        ].sort()
      )

      expect(
        ownState?.moderationReason ?? '',
        'The moderation reason must carry a stable code, never the term that matched.'
      ).not.toContain('merde')
      expect(
        ownState?.moderationReason ?? '',
        'The moderation reason must not carry a class probability.'
      ).not.toMatch(/Porn|Sexy|Hentai|Drawing|Neutral/)
    }
  )
})

/**
 * A second real account, registered for the same teardown as the first. The
 * cross-user assertion needs a genuine viewer rather than a header swap on the
 * same id, because the visibility rule is `status === 'published' || user_id ===
 * viewer`, and reusing the author's id would satisfy the second half.
 */
async function signUpSecondMember(
  request: APIRequestContext,
  communityApi: { apiBaseUrl: string; trackUser: (userId: string) => void },
  testInfo: TestInfo
): Promise<string> {
  // `buildUniqueId` rather than a timestamp: it folds in the worker index and
  // the repeat-each index, and `npm run test:pw:burn-in` runs three copies in
  // parallel that would otherwise mint the same email in the same millisecond.
  const userId = await signUpCommunityUser(
    request,
    communityApi.apiBaseUrl,
    buildUniqueId('viewer', testInfo)
  )
  communityApi.trackUser(userId)
  return userId
}
