// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Jade, 2026-11-19, community fleet: a look held by screening must reach the moderator queue
// quickly. Production proof (2026-11-19): a profanity caption was held, listed in /moderation
// and due 30 minutes after it was accepted. The unit and integration specs pin the constant;
// this spec proves the whole path from the member's publish to the moderator's queue row.
// Local stack only: it writes a post and cleans its rows through the database, and a synthetic
// moderator bearer is rejected in production (the prod proof was run by hand with a minted user).
import {
  moderationCasesResponseSchema,
  SCREENING_HOLD_SLA_MS,
} from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  authHeaders,
  buildUniqueId,
  isNonLocalEnvironment,
  resolveApiBaseUrl,
} from '../support/helpers/api-test'
import {
  deleteCommunityRowsForUser,
  loadCommunityFixture,
  publishCommunityLook,
  signUpCommunityUser,
  waitForTerminalAuthorState,
} from '../support/helpers/community-session'

test.describe('Jade community: a screening hold reaches the moderator queue', () => {
  test('JADE-COMMUNITY-003: a profane caption is held and listed due 30 minutes after acceptance', async ({
    request,
    apiRequest,
    recurse,
  }, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Writes a post and needs synthetic bearers; production proof is the manual run recorded in the learning path.'
    )
    test.setTimeout(180_000)
    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const authorId = await signUpCommunityUser(
      request,
      apiBaseUrl,
      buildUniqueId('hold-author', testInfo)
    )
    const moderatorId = await signUpCommunityUser(
      request,
      apiBaseUrl,
      buildUniqueId('hold-moderator', testInfo)
    )
    try {
      const published = await publishCommunityLook(request, {
        apiBaseUrl,
        userId: authorId,
        fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
        altText: 'Synthetic plum satin fabric',
        caption: 'This weather is bullshit, so I layered up.',
      })
      const terminal = await waitForTerminalAuthorState(
        { apiRequest, recurse },
        { apiBaseUrl, userId: authorId, postId: published.postId }
      )
      // Held for review: the author sees it, nobody else does.
      expect(terminal.status).not.toBe('published')

      const caseId = `post.${published.postId}`
      const listed = await recurse(
        async () => {
          const { status, body } = await apiRequest<unknown>({
            method: 'GET',
            path: '/api/v1/moderation/cases',
            baseUrl: apiBaseUrl,
            headers: authHeaders(moderatorId, 'moderator'),
            params: { status: 'open', limit: 50 },
          })
          expect(status, JSON.stringify(body)).toBe(200)
          const page = moderationCasesResponseSchema.parse(body)
          return { found: page.data.items.find((item) => item.caseId === caseId) }
        },
        ({ found }) => found !== undefined,
        { timeout: 90_000, interval: 1_000, log: false }
      )

      const held = listed.found!
      expect(held.status).toBe('open')
      expect(
        new Date(held.slaDueAt).getTime() - new Date(held.acceptedAt).getTime()
      ).toBe(SCREENING_HOLD_SLA_MS)
      expect(SCREENING_HOLD_SLA_MS).toBe(30 * 60 * 1000)
    } finally {
      await deleteCommunityRowsForUser(authorId)
    }
  })
})
