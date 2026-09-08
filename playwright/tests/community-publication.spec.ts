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
import type { APIRequestContext } from '@playwright/test'
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

/*
 * The highest-confidence entry in the v1 corpus (Neutral 0.9991). Chosen so the
 * safe journey stays green once the real model replaces the fixture: a fixture
 * that only passes because the fixture screener passes everything would start
 * failing the moment this file became useful.
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
    async ({ request, communityApi }) => {
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
      expect(terminal.moderationReason).toBeTruthy()

      await log.step('The refused look is absent from a second member feed')
      const otherUserId = await signUpSecondMember(request, communityApi)
      const feedResponse = await request.get(
        `${communityApi.apiBaseUrl}${COMMUNITY_FEED_PATH}?mode=all`,
        {
          headers: {
            ...communityApi.headers,
            'x-user-id': otherUserId,
            authorization: 'Bearer test-token-guardian',
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
       * No raw safety data in a client response. The reason code is a stable
       * identifier the author is meant to see; the matched term, the class
       * probabilities and the signed URL are not, and none of them may appear
       * anywhere in the payload.
       */
      const rawFeed = JSON.stringify(feed)
      expect(rawFeed).not.toContain('merde')
      for (const leaked of ['Porn', 'Sexy', 'Hentai', 'Drawing', 'Neutral']) {
        expect(
          rawFeed,
          `The feed payload must not carry the ${leaked} class probability.`
        ).not.toContain(leaked)
      }
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
  communityApi: { apiBaseUrl: string; trackUser: (userId: string) => void }
): Promise<string> {
  const userId = await signUpCommunityUser(
    request,
    communityApi.apiBaseUrl,
    `viewer-${Date.now()}`
  )
  communityApi.trackUser(userId)
  return userId
}
