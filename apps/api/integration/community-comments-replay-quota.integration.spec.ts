// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
import { describe, expect, it } from 'vitest'
import type { CreateCommunityCommentInput } from '@couture/api-client/contracts/http'
import {
  commentRow,
  commentsTestContext,
  DAY_MS,
  HOUR_MS,
  pinClock,
  SECOND_MS,
} from './helpers/community-comments-context.js'

const { prisma, service, input, fixture, create, publish } = commentsTestContext()

// Accepted contract values: 60 comments per rolling minute and 200 per rolling day.
const COMMENT_MINUTE_LIMIT = 60
const COMMENT_DAILY_LIMIT = 200
const MINUTE_WINDOW_MS = 60 * SECOND_MS
const NOW = new Date('2026-10-19T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

async function seedRows(userId: string, postId: string, count: number, createdAt: Date) {
  await prisma.communityComment.createMany({
    data: Array.from({ length: count }, () =>
      commentRow({ post_id: postId, user_id: userId, created_at: createdAt })
    ),
  })
}

describe('Story 6.4 comment submission windows with a pinned clock', () => {
  it.each([
    {
      name: 'a 59-second-old row fills the minute window',
      fill: COMMENT_MINUTE_LIMIT - 1,
      fillAge: 30 * SECOND_MS,
      edgeAge: MINUTE_WINDOW_MS - SECOND_MS,
      retryAfterSeconds: 1,
    },
    {
      name: 'a 23h59m59s-old row fills the day window',
      fill: COMMENT_DAILY_LIMIT - 1,
      fillAge: HOUR_MS,
      edgeAge: DAY_MS - SECOND_MS,
      retryAfterSeconds: 1,
    },
  ])('refuses when $name, with the exact Retry-After', async (row) => {
    const actor = await fixture()
    await seedRows(actor.userId, actor.postId, row.fill, ago(row.fillAge))
    await seedRows(actor.userId, actor.postId, 1, ago(row.edgeAge))
    pinClock(NOW)
    await expect(create(actor.userId, actor.postId)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: row.retryAfterSeconds,
    })
  })

  it.each([
    {
      name: 'a 61-second-old row has left the minute window',
      fill: COMMENT_MINUTE_LIMIT - 1,
      fillAge: 30 * SECOND_MS,
      edgeAge: MINUTE_WINDOW_MS + SECOND_MS,
    },
    {
      name: 'a 24h00m01s-old row has left the day window',
      fill: COMMENT_DAILY_LIMIT - 1,
      fillAge: HOUR_MS,
      edgeAge: DAY_MS + SECOND_MS,
    },
  ])('accepts when $name', async (row) => {
    const actor = await fixture()
    await seedRows(actor.userId, actor.postId, row.fill, ago(row.fillAge))
    await seedRows(actor.userId, actor.postId, 1, ago(row.edgeAge))
    pinClock(NOW)
    expect((await create(actor.userId, actor.postId)).status).toBe('pending_screening')
  })

  it('lets an accepted retry through a full minute window', async () => {
    const actor = await fixture()
    const request = input()
    const accepted = await create(actor.userId, actor.postId, request)
    await prisma.communityComment.update({
      where: { id: accepted.id },
      data: { created_at: ago(30 * SECOND_MS) },
    })
    await seedRows(
      actor.userId,
      actor.postId,
      COMMENT_MINUTE_LIMIT - 1,
      ago(30 * SECOND_MS)
    )
    pinClock(NOW)
    await expect(create(actor.userId, actor.postId)).rejects.toMatchObject({
      status: 429,
    })
    expect(await create(actor.userId, actor.postId, request)).toMatchObject({
      id: accepted.id,
      status: 'pending_screening',
    })
  })
})

describe('Story 6.4 private submission paging', () => {
  it('pages private submissions by keyset and refuses malformed or foreign cursors', async () => {
    const actor = await fixture()
    await create(actor.userId, actor.postId)
    await seedRows(actor.userId, actor.postId, 3, new Date())
    const first = await service.submissions({
      userId: actor.userId,
      postId: actor.postId,
      limit: 2,
    })
    const second = await service.submissions({
      userId: actor.userId,
      postId: actor.postId,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    })
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4)
    await expect(
      service.submissions({
        userId: actor.userId,
        postId: actor.postId,
        limit: 2,
        cursor: 'bad',
      })
    ).rejects.toMatchObject({ status: 400 })
    const other = await fixture()
    await expect(
      service.submissions({
        userId: other.userId,
        postId: actor.postId,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      })
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('Story 6.4 comment receipt replay identity', () => {
  it.each([
    {
      change: 'locale',
      replay: (request: CreateCommunityCommentInput, actor: Actor) =>
        Promise.resolve({
          postId: actor.postId,
          request: { ...request, locale: 'fr-FR' as const },
        }),
    },
    {
      change: 'parentId',
      replay: async (request: CreateCommunityCommentInput, actor: Actor) => ({
        postId: actor.postId,
        request: { ...request, parentId: (await publish(actor.userId, actor.postId)).id },
      }),
    },
    {
      change: 'post',
      replay: (request: CreateCommunityCommentInput, actor: Actor) =>
        Promise.resolve({ postId: actor.otherPostId, request }),
    },
  ])('refuses a mutation id replayed with a changed $change', async ({ replay }) => {
    const owner = await fixture()
    const actor = { ...owner, otherPostId: (await fixture()).postId }
    const request = input()
    const accepted = await create(actor.userId, actor.postId, request)
    const changed = await replay(request, actor)
    await expect(
      create(actor.userId, changed.postId, changed.request)
    ).rejects.toMatchObject({ status: 409 })
    expect(
      await prisma.communityCommentReceipt.findMany({
        where: { user_id: actor.userId, mutation_id: request.mutationId },
        select: { comment_id: true },
      })
    ).toEqual([{ comment_id: accepted.id }])
  })

  it('collapses concurrent creates of one mutation id into one comment and one receipt', async () => {
    const actor = await fixture()
    const request = input()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => create(actor.userId, actor.postId, request))
    )
    expect(new Set(results.map((result) => result.id)).size).toBe(1)
    expect(
      await prisma.communityComment.count({ where: { user_id: actor.userId } })
    ).toBe(1)
    expect(
      await prisma.communityCommentReceipt.count({ where: { user_id: actor.userId } })
    ).toBe(1)
  })
})

type Actor = { userId: string; postId: string; otherPostId: string }
