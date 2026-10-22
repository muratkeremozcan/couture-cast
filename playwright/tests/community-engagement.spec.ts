import { randomInt, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import {
  communityCommentSubmissionResponseSchema,
  communityConflictResponseSchema,
  communityEventsResponseSchema,
  resolveCommunityTargetsResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  test,
  expect,
  accountFor,
  engagementToken,
  openAll,
  openComments,
  closeComments,
  thread,
  interceptFor,
  observeCommunitySocket,
  watchContentStaysVisible,
  observeCommunityFallbackTimers,
  communityTestDatabase,
  disablePeriodicCommunityPolling,
  submitComment,
  settleComment,
  takeDownCommunityLook,
  requestCommunityAccountErasure,
  expectErasedAuthorDenial,
} from '../support/helpers/community-engagement'
import {
  loadCommunityFixture,
  publishCommunityLook,
  waitForTerminalAuthorState,
} from '../support/helpers/community-session'
import { checkA11y } from '../support/helpers/accessibility'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../support/helpers/commerce-session'

const POST = 'lookbook-5'
const evidenceJson = (value: unknown) =>
  JSON.stringify(
    value,
    (_key, entry: unknown) =>
      typeof entry === 'string' && entry.includes('/storage/v1/object/sign/')
        ? entry.split('?')[0]
        : entry,
    2
  )
const digits = () => String(randomInt(1_000_000_000, 10_000_000_000))
const prisma = communityTestDatabase

test.describe('Story 6.5 real engagement transport', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  test('[P0] E2E-001 healthy socket delivers two-browser reactions, comments and buffered new looks without healthy fallback polling', async ({
    page,
    authorPage,
    communitySession,
    communityApi,
    apiRequest,
    recurse,
    request,
  }, testInfo) => {
    expect(communitySession.userId).not.toBe(communityApi.userId)
    const fallbackArms = await observeCommunityFallbackTimers(page)
    const transport = await observeCommunitySocket(page)
    await openAll(page)
    await openAll(authorPage)
    await recurse(
      () => Promise.resolve(transport.handshakes),
      (count) => count > 0,
      { timeout: 10_000 }
    )
    const before = transport.doorbells
    const reaction = page.getByTestId(`community-reactions-${POST}`)
    const actorReaction = authorPage.getByTestId(`community-reactions-${POST}`)
    const initial = Number(
      (await reaction
        .getByRole('button', { name: /^Applaud,/ })
        .getAttribute('aria-label'))!.split(',')[1]
    )
    const mutation = interceptFor(authorPage)({
      method: 'PUT',
      url: `**/community/posts/${POST}/reaction`,
    })
    await actorReaction.getByRole('button', { name: /^Applaud,/ }).click()
    expect((await mutation).status).toBe(200)
    await expect(
      reaction.getByRole('button', { name: `Applaud, ${initial + 1}`, exact: true })
    ).toBeVisible({ timeout: 10_000 })
    await openComments(page, POST)
    await thread(page).getByLabel('Add a comment').fill('My retained reader draft')
    await openComments(authorPage, POST)
    const body = `Wool layers ${digits()}`
    await thread(authorPage).getByLabel('Add a comment').fill(body)
    const created = interceptFor(authorPage)({
      method: 'POST',
      url: `**/community/posts/${POST}/comments`,
    })
    await thread(authorPage)
      .getByRole('button', { name: 'Send comment', exact: true })
      .click()
    const result = await created
    expect(result.status).toBe(200)
    const comment = communityCommentSubmissionResponseSchema.parse(
      result.responseJson
    ).data
    expect(
      (await settleComment({ apiRequest, recurse }, communityApi, POST, comment.id))
        .status
    ).toBe('published')
    await expect(thread(page).getByTestId(`comment-${comment.id}`)).toContainText(body, {
      timeout: 10_000,
    })
    await expect(thread(page).getByLabel('Add a comment')).toHaveValue(
      'My retained reader draft'
    )
    await expect(thread(page).getByLabel('Add a comment')).toBeFocused()
    expect(transport.doorbells).toBeGreaterThan(before)
    // Wall-clock observation covers one full fallback interval. No manually driven refresh is used.
    // Parallel workers may ring legitimate doorbells, so every read must follow one within 2 s;
    // fallback reads cannot start before 7.5 s and arming itself stays pinned.
    const initialArms = await fallbackArms()
    const quietStart = Date.now(),
      reads = transport.reads.length
    await recurse(
      async () => ({
        elapsed: Date.now() - quietStart,
        unexplained: transport.reads
          .slice(reads)
          .filter(
            (read) =>
              !transport.bells.some((bell) => bell <= read.at && read.at - bell <= 2_000)
          )
          .map((read) => `${read.path}@${read.at - quietStart}ms`),
        armed: await fallbackArms(),
      }),
      (value) => {
        expect(value.unexplained).toEqual([])
        expect(value.armed).toBe(initialArms)
        return value.elapsed >= 8_100
      },
      { timeout: 9_500, interval: 100 }
    )
    const published = await publishCommunityLook(request, {
      apiBaseUrl: communityApi.apiBaseUrl,
      userId: communityApi.userId,
      fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
      altText: 'Synthetic plum satin fabric',
      caption: `Plum layers ${digits()}`,
    })
    expect(
      (
        await waitForTerminalAuthorState(
          { apiRequest, recurse },
          { ...communityApi, postId: published.postId }
        )
      ).status
    ).toBe('published')
    await expect(thread(page).getByLabel('Add a comment')).toHaveValue(
      'My retained reader draft'
    )
    await closeComments(page)
    const insert = page.getByRole('button', { name: /Show \d+ new look/ })
    await expect(insert).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId(`lookbook-card-${published.postId}`)).toHaveCount(0)
    await insert.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`lookbook-card-${published.postId}`)).toBeVisible()
    await checkA11y(page)
    await page.screenshot({
      path: testInfo.outputPath('healthy-new-look.png'),
      fullPage: true,
    })
  })

  test(
    '[P0] E2E-002 real socket outage falls back within eight seconds, reconnects and resyncs an expired epoch',
    { annotation: [{ type: 'expectedCommunityResync' }] },
    async (
      { page, authorPage, communitySession, communityApi, apiRequest, recurse },
      testInfo
    ) => {
      expect(communitySession.userId).not.toBe(communityApi.userId)
      const transport = await observeCommunitySocket(page)
      await openAll(page)
      await openAll(authorPage)
      await recurse(
        () => Promise.resolve(transport.handshakes),
        (value) => value > 0,
        { timeout: 10_000 }
      )
      await openComments(page, POST)
      await thread(page).getByLabel('Add a comment').fill('Draft across an outage')
      // D3/D9: a reconnecting socket is not an outage. The card, the open thread and
      // the draft stay visible while HTTP fallback serves events.
      const stopWatching = await watchContentStaysVisible(page, POST)
      const outage = Date.now()
      await transport.disconnect()
      const comment = await submitComment(
        { apiRequest, recurse },
        communityApi,
        POST,
        `Recovery layers ${digits()}`
      )
      expect(
        (await settleComment({ apiRequest, recurse }, communityApi, POST, comment.id))
          .status
      ).toBe('published')
      await expect(thread(page).getByTestId(`comment-${comment.id}`)).toBeVisible({
        timeout: 20_000,
      })
      const first = transport.reads.find(
        (read) => read.at >= outage && read.path.endsWith('/events')
      )
      expect(first).toBeDefined()
      expect(first!.at - outage).toBeLessThanOrEqual(8_000)
      await expect(thread(page).getByLabel('Add a comment')).toHaveValue(
        'Draft across an outage'
      )
      await expect(page.getByTestId(`lookbook-card-${POST}`)).toBeVisible()
      expect(await stopWatching()).toEqual([])
      const handshakes = transport.handshakes
      // A different owner keeps a valid cursor throughout this worker's private reset.
      const independent = await apiRequest<unknown>({
        method: 'GET',
        path: '/api/v1/community/events?mode=all',
        baseUrl: communityApi.apiBaseUrl,
        headers: communityApi.headers,
        retryConfig: { maxRetries: 0 },
      })
      expect(independent.status).toBe(200)
      const independentCursor = communityEventsResponseSchema.parse(independent.body).data
        .nextCursor
      const db = prisma()
      try {
        const rotated = await db.communityStreamHead.updateMany({
          where: { owner_id: communitySession.userId },
          data: { epoch: randomUUID() },
        })
        expect(rotated.count).toBe(1)
      } finally {
        await db.$disconnect()
      }
      const unaffected = await apiRequest<unknown>({
        method: 'GET',
        path: `/api/v1/community/events?mode=all&cursor=${encodeURIComponent(independentCursor)}`,
        baseUrl: communityApi.apiBaseUrl,
        headers: communityApi.headers,
        retryConfig: { maxRetries: 0 },
      })
      expect(unaffected.status).toBe(200)
      expect(
        communityEventsResponseSchema.parse(unaffected.body).data.resyncRequired
      ).toBe(false)
      // playwright-utils deviation: interceptNetworkCall always awaits response.json().
      // The app reads only the status of this 409, and Chromium never finishes an
      // unread fetch body, so observe status and URL here; the replay checks the body.
      const resync = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'GET' &&
          new URL(candidate.url()).pathname === '/api/v1/community/events'
      )
      transport.reconnect()
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      const response = await resync
      expect(response.status()).toBe(409)
      const staleCursor = new URL(response.url())
      const conflict = await apiRequest<unknown>({
        method: 'GET',
        path: staleCursor.pathname + staleCursor.search,
        ...{
          baseUrl: communitySession.apiBaseUrl,
          headers: accountFor(communitySession).headers,
        },
        retryConfig: { maxRetries: 0 },
      })
      expect(conflict.status).toBe(409)
      expect(communityConflictResponseSchema.parse(conflict.body).code).toBe(
        'resync_required'
      )
      await recurse(
        () => Promise.resolve(transport.handshakes),
        (count) => count > handshakes,
        { timeout: 20_000 }
      )
      await expect(thread(page).getByTestId(`comment-${comment.id}`)).toHaveCount(1)
      await expect(thread(page).getByLabel('Add a comment')).toHaveValue(
        'Draft across an outage'
      )
      await page.screenshot({
        path: testInfo.outputPath('fallback-reconnected-draft.png'),
      })
    }
  )

  test('[P0] E2E-003 private screening status stays on its author and deletion invalidates the other browser', async ({
    page,
    authorPage,
    communitySession,
    communityApi,
    apiRequest,
    recurse,
  }) => {
    expect(communitySession.userId).not.toBe(communityApi.userId)
    await disablePeriodicCommunityPolling(page)
    await disablePeriodicCommunityPolling(authorPage)
    const readerSocket = await observeCommunitySocket(page)
    const authorSocket = await observeCommunitySocket(authorPage)
    await openAll(page)
    await openAll(authorPage)
    await openComments(page, POST)
    await openComments(authorPage, POST)
    await recurse(
      () => Promise.resolve(readerSocket.handshakes > 0 && authorSocket.handshakes > 0),
      Boolean,
      { timeout: 10_000 }
    )
    const heldBody = `damn ${digits()}`
    const held = await submitComment(
      { apiRequest, recurse },
      communityApi,
      POST,
      heldBody
    )
    expect(
      (await settleComment({ apiRequest, recurse }, communityApi, POST, held.id)).status
    ).toBe('held_for_review')
    await expect(
      thread(authorPage).getByTestId(`comment-submission-${held.id}`)
    ).toContainText('Held for review. Only you can see this.', { timeout: 10_000 })
    await expect(thread(page).getByText(heldBody)).toHaveCount(0)
    await expect(thread(page).getByTestId(`comment-submission-${held.id}`)).toHaveCount(0)
    const publicComment = await submitComment(
      { apiRequest, recurse },
      communityApi,
      POST,
      `Soft coat ${digits()}`
    )
    expect(
      (await settleComment({ apiRequest, recurse }, communityApi, POST, publicComment.id))
        .status
    ).toBe('published')
    await expect(thread(page).getByTestId(`comment-${publicComment.id}`)).toBeVisible()
    const erased = await apiRequest({
      method: 'DELETE',
      path: `/api/v1/community/posts/${POST}/comments/${publicComment.id}`,
      baseUrl: communityApi.apiBaseUrl,
      headers: communityApi.headers,
    })
    expect(erased.status).toBe(200)
    await expect(
      thread(page).getByText(publicComment.body!, { exact: true })
    ).toHaveCount(0, { timeout: 10_000 })
    // The author-only row can still explain its own disposition without exposing it to the reader.
    await expect(
      thread(authorPage).getByTestId(`comment-submission-${held.id}`)
    ).toContainText(heldBody)
  })

  test('[P0] E2E-004 off-page notification focuses the exact reply and reconciles its removal', async ({
    page,
    communitySession,
    communityApi,
    apiRequest,
    recurse,
    interceptNetworkCall,
  }, testInfo) => {
    expect(communitySession.userId).not.toBe(communityApi.userId)
    // Historical pagination fixture. Visibility, resolver, focus and subsequent removal use production HTTP and state.
    const db = prisma(),
      prefix = `h1-${randomUUID()}`
    const rootId = `${prefix}-root`,
      replyId = `${prefix}-reply`
    try {
      await db.$transaction(async (tx) => {
        const post = await tx.lookbookPost.update({
          where: { id: POST },
          data: { comment_publication_sequence: { increment: 45 } },
        })
        const last = post.comment_publication_sequence
        await tx.communityComment.createMany({
          data: Array.from({ length: 45 }, (_, i) => ({
            id: i === 22 ? rootId : i === 44 ? replyId : `${prefix}-${i}`,
            post_id: POST,
            user_id: communityApi.userId,
            parent_id: i > 22 ? rootId : null,
            body: `Historical linen ${i}`,
            locale: 'en-US',
            status: 'published' as const,
            publication_sequence: last - 44 + i,
            published_at: new Date(),
            platform: 'web',
          })),
        })
      })
    } finally {
      await db.$disconnect()
    }
    const targetProof = await apiRequest<unknown>({
      method: 'POST',
      path: '/api/v1/community/targets/resolve',
      baseUrl: communitySession.apiBaseUrl,
      headers: accountFor(communitySession).headers,
      body: { targets: [{ key: 'notification', postId: POST, commentId: replyId }] },
    })
    expect(targetProof.status).toBe(200)
    const target = resolveCommunityTargetsResponseSchema.parse(targetProof.body).data
      .targets[0]
    expect(target).toMatchObject({
      status: 'available',
      comment: { id: replyId, parentId: rootId },
      parent: { id: rootId },
    })
    const targetPath = testInfo.outputPath('actual-target.json')
    await writeFile(targetPath, evidenceJson(target))
    await testInfo.attach('actual-target.json', {
      path: targetPath,
      contentType: 'application/json',
    })
    // playwright-utils deviation: a diagnostic multi-request timeline needs concurrent lifecycle events.
    // The network-error monitor and per-call utility remain the assertion boundaries.
    const timeline: unknown[] = []
    const bodies: Promise<void>[] = []
    const origin = Date.now()
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!url.pathname.startsWith('/api/v1/community/')) return
      timeline.push({
        kind: 'start',
        at: Date.now() - origin,
        path: url.pathname + url.search,
        target: url.pathname.endsWith('/targets/resolve')
          ? (request.postDataJSON() as unknown)
          : undefined,
      })
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (!/\/(targets\/resolve|comments|replies)$/.test(url.pathname)) return
      const record: Record<string, unknown> = {
        kind: 'response',
        at: Date.now() - origin,
        path: url.pathname + url.search,
        status: response.status(),
      }
      timeline.push(record)
      bodies.push(
        response
          .json()
          .then((body) => {
            record.body = body
          })
          .catch(() => {
            record.bodyUnavailable = true
          })
      )
    })
    const located = interceptNetworkCall({
      method: 'POST',
      url: '**/community/targets/resolve',
    })
    await page.goto(
      `/?source=notification&type=community&cardId=${POST}&commentId=${replyId}`
    )
    expect((await located).status).toBe(200)
    const focused = thread(page).getByTestId(`comment-${replyId}`)
    try {
      await expect(focused).toBeFocused({ timeout: 10_000 })
    } finally {
      await Promise.all(bodies)
      const timelinePath = testInfo.outputPath('target-request-timeline.json')
      await writeFile(timelinePath, evidenceJson(timeline))
      await testInfo.attach('target-request-timeline.json', {
        path: timelinePath,
        contentType: 'application/json',
      })
    }
    await expect(focused).toContainText('Historical linen 44')
    await checkA11y(page)
    await page.screenshot({ path: testInfo.outputPath('off-page-exact-reply.png') })
    const removed = await apiRequest({
      method: 'DELETE',
      path: `/api/v1/community/posts/${POST}/comments/${replyId}`,
      baseUrl: communityApi.apiBaseUrl,
      headers: communityApi.headers,
    })
    expect(removed.status).toBe(200)
    await recurse(
      async () => ({ count: await focused.getByText('Historical linen 44').count() }),
      (value) => value.count === 0,
      { timeout: 10_000 }
    )
    await expect(thread(page).getByLabel('Add a comment')).toBeVisible()
  })

  test('[P0] E2E-005 a late prior-account target result cannot replace the new account or draft', async ({
    page,
    communitySession,
    communityApi,
    interceptNetworkCall,
    apiRequest,
    recurse,
  }) => {
    expect(communitySession.userId).not.toBe(communityApi.userId)
    const targetComment = await submitComment(
      { apiRequest, recurse },
      communityApi,
      POST,
      `Prior account linen ${digits()}`
    )
    expect(
      (await settleComment({ apiRequest, recurse }, communityApi, POST, targetComment.id))
        .status
    ).toBe('published')
    const transport = await observeCommunitySocket(page)
    const nextToken = engagementToken(communityApi.userId)
    const nextOwnerReads: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (
        path.startsWith('/api/v1/community/') &&
        request.headers().authorization === `Bearer ${nextToken}`
      )
        nextOwnerReads.push(path)
    })
    let release!: () => void, reached!: () => void, completed!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      reached = resolve
    })
    const settled = new Promise<void>((resolve) => {
      completed = resolve
    })
    let first = true
    const held = interceptNetworkCall({
      method: 'POST',
      url: '**/community/targets/resolve',
      handler: async (route) => {
        const input = route.request().postDataJSON() as { targets?: { key: string }[] }
        if (!first || !input.targets?.some((target) => target.key === 'notification')) {
          await route.continue()
          return
        }
        first = false
        expect(
          route.request().headers().authorization ===
            `Bearer ${communitySession.accessToken}`
        ).toBe(true)
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        const data = resolveCommunityTargetsResponseSchema.parse(
          await response.json()
        ).data
        expect(data.targets[0]).toMatchObject({
          status: 'available',
          comment: { id: targetComment.id },
        })
        reached()
        try {
          await hold
          await route.fulfill({ response })
        } finally {
          completed()
        }
      },
    })
    await page.goto(
      `/?source=notification&type=community&cardId=${POST}&commentId=${targetComment.id}`
    )
    await entered
    await recurse(
      () => Promise.resolve(transport.handshakes),
      (count) => count >= 1,
      { timeout: 10_000 }
    )
    try {
      await page.evaluate(
        ([key, token]) => {
          sessionStorage.setItem(key!, token!)
          window.dispatchEvent(new Event('couture:session'))
        },
        [WEB_ACCESS_TOKEN_STORAGE_KEY, nextToken]
      )
      await recurse(
        () => Promise.resolve(transport.handshakes),
        (count) => count >= 2,
        { timeout: 10_000 }
      )
      await closeComments(page)
      await page.getByTestId('community-filter-all').click()
      await openComments(page, 'lookbook-3')
      await thread(page).getByLabel('Add a comment').fill('New owner draft')
    } finally {
      release()
    }
    await held
    await settled
    await expect(thread(page).getByLabel('Add a comment')).toHaveValue('New owner draft')
    await expect(page.getByTestId('community-detail-caption')).toContainText('Look 3')
    await expect(thread(page).getByTestId(`comment-${targetComment.id}`)).toHaveCount(0)
    expect(nextOwnerReads).toContain('/api/v1/community/feed')
    expect(nextOwnerReads).toContain('/api/v1/community/events')
    await expect(thread(page).getByLabel('Add a comment')).toBeFocused()
    expect(accountFor(communitySession).apiBaseUrl).toBe(communityApi.apiBaseUrl)
  })

  test(
    '[P0] E2E-003 takedown and account erasure invalidate live cards and matching discussions while unrelated drafts survive',
    { annotation: [{ type: 'expectedAuthorErasureDenial' }] },
    async (
      { page, authorPage, communitySession, communityApi, apiRequest, recurse, request },
      testInfo
    ) => {
      expect(communitySession.userId).not.toBe(communityApi.userId)
      const posts: string[] = []
      for (const label of ['Takedown linen', 'Erasure linen']) {
        const published = await publishCommunityLook(request, {
          apiBaseUrl: communityApi.apiBaseUrl,
          userId: communityApi.userId,
          fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
          altText: 'Synthetic plum satin fabric',
          caption: `${label} ${digits()}`,
        })
        expect(
          (
            await waitForTerminalAuthorState(
              { apiRequest, recurse },
              { ...communityApi, postId: published.postId }
            )
          ).status
        ).toBe('published')
        posts.push(published.postId)
      }
      const [takenDown, erased] = posts as [string, string]
      await disablePeriodicCommunityPolling(page)
      await disablePeriodicCommunityPolling(authorPage)
      const reader = await observeCommunitySocket(page),
        author = await observeCommunitySocket(authorPage)
      await openAll(page)
      await openAll(authorPage)
      await recurse(
        () => Promise.resolve(reader.handshakes > 0 && author.handshakes > 0),
        Boolean,
        {
          timeout: 10_000,
        }
      )
      await openComments(page, takenDown)
      await thread(page).getByLabel('Add a comment').fill('Removed look draft')
      await openComments(authorPage, erased)
      await thread(authorPage).getByLabel('Add a comment').fill('Surviving look draft')
      await takeDownCommunityLook(takenDown, communitySession.userId)
      await expect(page.getByTestId(`lookbook-card-${takenDown}`)).toHaveCount(0, {
        timeout: 10_000,
      })
      await expect(thread(page)).toHaveCount(0)
      await expect(thread(authorPage).getByLabel('Add a comment')).toHaveValue(
        'Surviving look draft'
      )
      await expect(thread(authorPage).getByLabel('Add a comment')).toBeFocused()
      await expect(page.getByTestId(`lookbook-card-${erased}`)).toBeVisible()
      await openComments(page, erased)
      await thread(page).getByLabel('Add a comment').fill('Erased look draft')
      expectErasedAuthorDenial(authorPage)
      await requestCommunityAccountErasure(communityApi.userId)
      await expect(page.getByTestId(`lookbook-card-${erased}`)).toHaveCount(0, {
        timeout: 10_000,
      })
      await expect(authorPage.getByTestId(`lookbook-card-${erased}`)).toHaveCount(0, {
        timeout: 10_000,
      })
      await expect(thread(page)).toHaveCount(0)
      await expect(thread(authorPage)).toHaveCount(0)
      await expect(page.getByTestId('lookbook-card-lookbook-3')).toBeVisible()
      const denied = await apiRequest<unknown>({
        method: 'GET',
        path: '/api/v1/community/events?mode=all',
        baseUrl: communityApi.apiBaseUrl,
        headers: communityApi.headers,
        retryConfig: { maxRetries: 0 },
      })
      expect(denied.status).toBe(403)
      // No specialized denied-body schema exists; pin the agreed existing typed HTTP response exactly.
      expect(denied.body).toEqual({
        statusCode: 403,
        code: 'denied',
        message: 'Community account unavailable.',
      })
      expect(reader.doorbells).toBeGreaterThan(0)
      expect(author.doorbells).toBeGreaterThan(0)
      await page.screenshot({
        path: testInfo.outputPath('privacy-eviction.png'),
        fullPage: true,
      })
    }
  )
})
