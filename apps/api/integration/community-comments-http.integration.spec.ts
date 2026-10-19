import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import {
  buildCommunityPostReportCreateInput,
  createCommunityPostReport,
} from '@couture/testing'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { CommunityCommentsService } from '../src/modules/community/community-comments.service.js'
import {
  commentRow,
  commentsTestContext,
  DAY_MS,
  HOUR_MS,
  pinClock,
  SECOND_MS,
} from './helpers/community-comments-context.js'

const { prisma, repository, flags, guardian, input, fixture, publish, bootApp } =
  commentsTestContext()

// Accepted contract values: 50 shared reports per rolling day, 60 comments per minute,
// and at most 50 comments per page.
const REPORT_LIMIT = 50
const COMMENT_MINUTE_LIMIT = 60
const PAGE_LIMIT = 50
const NOW = new Date('2026-10-19T12:00:00.000Z')
const postPath = (postId: string) => `/api/v1/community/posts/${postId}`

describe('Story 6.4 guarded comment HTTP routes', () => {
  it('answers an unauthenticated read with 401 and private cache headers', async () => {
    const owner = await fixture()
    const { app, server } = await bootApp({ userId: owner.userId, cacheHeaders: true })
    try {
      const unauthenticated = await request(server).get(
        `${postPath(owner.postId)}/comments`
      )
      expect(unauthenticated.status).toBe(401)
      expect(unauthenticated.headers['cache-control']).toBe('private, no-store')
    } finally {
      await app.close()
    }
  })

  it('rejects malformed paging and invisible bodies before any thread work', async () => {
    const owner = await fixture()
    const { app, authorized } = await bootApp({ userId: owner.userId })
    const url = postPath(owner.postId)
    try {
      expect((await authorized('get', `${url}/comments?cursor=malformed`)).status).toBe(
        400
      )
      expect(
        (await authorized('get', `${url}/comments?limit=${PAGE_LIMIT + 1}`)).status
      ).toBe(400)
      expect(
        (await authorized('post', `${url}/comments`).send({ ...input(), body: '\u200b' }))
          .status
      ).toBe(400)
      expect(
        await prisma.communityComment.count({ where: { user_id: owner.userId } })
      ).toBe(0)
    } finally {
      await app.close()
    }
  })

  it.each(['\ud800', '\udfff'])(
    'rejects lone surrogate %j with a private 400',
    async (body) => {
      const owner = await fixture()
      const { app, authorized } = await bootApp({
        userId: owner.userId,
        cacheHeaders: true,
      })
      try {
        const malformed = await authorized(
          'post',
          `${postPath(owner.postId)}/comments`
        ).send({ ...input(), body })
        expect(malformed.status).toBe(400)
        expect(malformed.body).toMatchObject({
          message: 'Comment contains invalid Unicode.',
        })
        expect(malformed.headers['cache-control']).toBe('private, no-store')
      } finally {
        await app.close()
      }
    }
  )

  it('accepts a guardian emoji comment as pending screening', async () => {
    const owner = await fixture()
    const { app, authorized } = await bootApp({ userId: owner.userId, role: 'guardian' })
    try {
      const emoji = await authorized('post', `${postPath(owner.postId)}/comments`).send({
        ...input(),
        body: '😀',
      })
      expect(emoji.status).toBe(200)
      expect(emoji.body).toMatchObject({
        data: { body: '😀', status: 'pending_screening' },
      })
    } finally {
      await app.close()
    }
  })

  it('lets a revoked teen read, delete and report while refusing a new comment', async () => {
    const owner = await fixture(),
      teen = await fixture('teen')
    await prisma.guardianConsent.create({
      data: { guardian_id: owner.userId, teen_id: teen.userId, status: 'granted' },
    })
    const own = await publish(teen.userId, owner.postId)
    const target = await publish(owner.userId, owner.postId)
    await guardian.revokeConsent(owner.userId, teen.userId)
    const { app, authorized } = await bootApp({
      userId: teen.userId,
      role: 'teen',
      canTeenAccess: false,
      cacheHeaders: true,
    })
    const url = postPath(owner.postId)
    try {
      expect((await authorized('get', `${url}/comments`)).status).toBe(200)
      expect((await authorized('get', `${url}/comment-submissions`)).status).toBe(200)
      const refused = await authorized('post', `${url}/comments`).send(input())
      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ message: COMMUNITY_AGE_GATE_DENIED_MESSAGE })
      expect((await authorized('delete', `${url}/comments/${own.id}`)).status).toBe(200)
      const report = await authorized('post', `${url}/comments/${target.id}/report`).send(
        {
          reason: 'spam',
        }
      )
      expect(report.status).toBe(200)
      expect(report.headers['cache-control']).toBe('private, no-store')
    } finally {
      await app.close()
    }
  })

  it('returns an exact Retry-After when the shared report quota fills over HTTP', async () => {
    const author = await fixture(),
      reporter = await fixture()
    const target = await publish(author.userId, author.postId)
    const another = await publish(author.userId, author.postId)
    const seededAt = new Date(NOW.getTime() - HOUR_MS)
    await prisma.communityPostReport.createMany({
      data: Array.from({ length: REPORT_LIMIT - 1 }, () =>
        buildCommunityPostReportCreateInput(
          createCommunityPostReport(
            { reporterId: reporter.userId, postId: null, reason: 'spam' },
            { now: seededAt }
          )
        )
      ),
    })
    const { app, authorized } = await bootApp({
      userId: reporter.userId,
      cacheHeaders: true,
    })
    const url = postPath(author.postId)
    try {
      pinClock(NOW)
      const accepted = await authorized(
        'post',
        `${url}/comments/${target.id}/report`
      ).send({
        reason: 'spam',
      })
      expect(accepted.status).toBe(200)
      const limited = await authorized(
        'post',
        `${url}/comments/${another.id}/report`
      ).send({
        reason: 'spam',
      })
      expect(limited.status).toBe(429)
      // The oldest of the 50 counted reports is one hour old, so it expires in 23 hours.
      expect(limited.headers['retry-after']).toBe(String((DAY_MS - HOUR_MS) / SECOND_MS))
      expect(limited.headers['cache-control']).toBe('private, no-store')
    } finally {
      vi.useRealTimers()
      await app.close()
    }
  })

  it('keeps the durable analytics actor when a returning member submits after secret rotation', async () => {
    const owner = await fixture()
    const { app, authorized } = await bootApp({ userId: owner.userId })
    const submit = () =>
      authorized('post', `${postPath(owner.postId)}/comments`).send(input())
    const previous = process.env.ANALYTICS_ID_SECRET
    try {
      process.env.ANALYTICS_ID_SECRET = 'synthetic-rotation-before-at-least-32-characters'
      expect((await submit()).status).toBe(200)
      const subject = await prisma.communityCommentAnalyticsSubject.findUniqueOrThrow({
        where: { user_id: owner.userId },
      })
      process.env.ANALYTICS_ID_SECRET = 'synthetic-rotation-after-at-least-32-characters'
      const result = await submit()
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ data: { status: 'pending_screening' } })
      const events = await prisma.communityCommentAnalyticsOutbox.findMany({
        where: { actor: subject.actor },
      })
      expect(events).toHaveLength(2)
      expect(
        await prisma.communityCommentAnalyticsSubject.findUniqueOrThrow({
          where: { user_id: owner.userId },
        })
      ).toEqual(subject)
    } finally {
      if (previous === undefined) delete process.env.ANALYTICS_ID_SECRET
      else process.env.ANALYTICS_ID_SECRET = previous
      await app.close()
    }
  })

  it('returns the shared earliest expiry through guarded post/comment report routes with a pinned clock', async () => {
    const author = await fixture(),
      reporter = await fixture()
    const target = await publish(author.userId, author.postId)
    const acceptedAt = new Date(NOW.getTime() - 23 * HOUR_MS)
    // All 50 counted reports were accepted 23 hours ago, so they expire in one hour.
    const oneHourRetryAfter = String(HOUR_MS / SECOND_MS)
    await prisma.communityCommentReport.createMany({
      data: Array.from({ length: REPORT_LIMIT }, () => ({
        reporter_id: reporter.userId,
        reason: 'spam',
        accepted_at: acceptedAt,
        routed_at: acceptedAt,
        sla_due_at: new Date(acceptedAt.getTime() + DAY_MS),
      })),
    })
    const { app, authorized } = await bootApp({
      userId: reporter.userId,
      role: 'guardian',
      withPostRoutes: true,
    })
    pinClock(NOW)
    try {
      for (const suffix of [`/comments/${target.id}/report`, '/report']) {
        const result = await authorized(
          'post',
          `${postPath(author.postId)}${suffix}`
        ).send({
          reason: 'spam',
        })
        expect(result.status).toBe(429)
        expect(result.headers['retry-after']).toBe(oneHourRetryAfter)
      }
    } finally {
      vi.useRealTimers()
      await app.close()
    }
  })
})

describe('Story 6.4 comment eligibility at the HTTP boundary', () => {
  type Call = Awaited<ReturnType<typeof bootApp>>['authorized']
  it.each([
    ['list', (call: Call, url: string) => call('get', url)],
    ['create', (call: Call, url: string) => call('post', url).send(input())],
  ] as const)('refuses an under-13 member who tries to %s', async (_operation, send) => {
    const owner = await fixture(),
      child = await fixture('child')
    const { app, authorized } = await bootApp({ userId: child.userId, role: 'teen' })
    try {
      const refused = await send(authorized, `${postPath(owner.postId)}/comments`)
      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ message: COMMUNITY_AGE_GATE_DENIED_MESSAGE })
      expect(
        await prisma.communityComment.count({ where: { user_id: child.userId } })
      ).toBe(0)
    } finally {
      await app.close()
    }
  })

  it('refuses creation with 503 and writes nothing while only the write flag is off', async () => {
    const owner = await fixture()
    flags.getFeatureFlag.mockImplementation((key: string) =>
      Promise.resolve(key !== 'community_write_enabled')
    )
    const { app, authorized } = await bootApp({ userId: owner.userId })
    try {
      const disabled = await authorized(
        'post',
        `${postPath(owner.postId)}/comments`
      ).send(input())
      expect(disabled.status).toBe(503)
      expect(disabled.body).toMatchObject({ message: COMMUNITY_FEED_DISABLED_MESSAGE })
      expect(
        await prisma.communityComment.count({ where: { user_id: owner.userId } })
      ).toBe(0)
      expect(
        await prisma.communityCommentReceipt.count({ where: { user_id: owner.userId } })
      ).toBe(0)
      expect(
        await prisma.communityCommentScreeningOutbox.count({
          where: { comment: { post_id: owner.postId } },
        })
      ).toBe(0)
      expect(
        await prisma.communityCommentAnalyticsSubject.count({
          where: { user_id: owner.userId },
        })
      ).toBe(0)
    } finally {
      await app.close()
    }
  })

  it('answers create, delete and report with 404 once the post is withdrawn', async () => {
    const author = await fixture(),
      member = await fixture()
    const own = await publish(member.userId, author.postId)
    const target = await publish(author.userId, author.postId)
    await prisma.lookbookPost.update({
      where: { id: author.postId },
      data: { status: 'withdrawn' },
    })
    const { app, authorized } = await bootApp({ userId: member.userId })
    const url = postPath(author.postId)
    try {
      expect((await authorized('post', `${url}/comments`).send(input())).status).toBe(404)
      expect((await authorized('delete', `${url}/comments/${own.id}`)).status).toBe(404)
      expect(
        (
          await authorized('post', `${url}/comments/${target.id}/report`).send({
            reason: 'spam',
          })
        ).status
      ).toBe(404)
      expect(
        await prisma.communityComment.findUniqueOrThrow({ where: { id: own.id } })
      ).toMatchObject({ status: 'published', body: 'Beautiful layers.' })
      expect(
        await prisma.communityComment.count({ where: { user_id: member.userId } })
      ).toBe(1)
      expect(
        await prisma.communityCommentReport.count({
          where: { reporter_id: member.userId },
        })
      ).toBe(0)
    } finally {
      await app.close()
    }
  })

  it('keeps a guardian infrastructure fault as the create failure instead of an age-gate refusal', async () => {
    const owner = await fixture()
    const outage = new Error('synthetic guardian store outage')
    const faulty = new CommunityCommentsService(
      repository,
      flags as never,
      {
        assertWardrobeUploadAllowed: vi.fn().mockRejectedValue(outage),
      } as never
    )
    await expect(
      faulty.create({
        userId: owner.userId,
        postId: owner.postId,
        input: input(),
        platform: 'web',
      })
    ).rejects.toBe(outage)
    expect(
      await prisma.communityComment.count({ where: { user_id: owner.userId } })
    ).toBe(0)
  })

  it('refuses the 61st create in a minute with an exact Retry-After, counting withheld rows and letting accepted replays through', async () => {
    const actor = await fixture()
    const accepted = input()
    const { app, authorized } = await bootApp({
      userId: actor.userId,
      cacheHeaders: true,
    })
    const url = `${postPath(actor.postId)}/comments`
    const burstAt = new Date(NOW.getTime() - 30 * SECOND_MS)
    try {
      const first = await authorized('post', url).send(accepted)
      expect(first.status).toBe(200)
      const acceptedId = (first.body as { data: { id: string } }).data.id
      await prisma.communityComment.update({
        where: { id: acceptedId },
        data: { created_at: burstAt },
      })
      await prisma.communityComment.createMany({
        data: Array.from({ length: COMMENT_MINUTE_LIMIT - 1 }, (_, index) =>
          commentRow({
            post_id: actor.postId,
            user_id: actor.userId,
            status: index % 2 ? 'held_for_review' : 'blocked',
            created_at: burstAt,
          })
        ),
      })
      pinClock(NOW)
      const limited = await authorized('post', url).send(input())
      expect(limited.status).toBe(429)
      // The oldest counted row is 30 seconds old and leaves the 60-second window in 30 seconds.
      expect(limited.headers['retry-after']).toBe('30')
      expect(limited.headers['cache-control']).toBe('private, no-store')
      expect(
        await prisma.communityComment.count({ where: { user_id: actor.userId } })
      ).toBe(COMMENT_MINUTE_LIMIT)
      const replay = await authorized('post', url).send(accepted)
      expect(replay.status).toBe(200)
      expect(replay.body).toMatchObject({
        data: { id: acceptedId, status: 'pending_screening' },
      })
    } finally {
      vi.useRealTimers()
      await app.close()
    }
  })
})
