import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { communityCommentBodySchema } from '@couture/api-client/contracts/http'
import { CommunityCommentsRepository } from '../src/modules/community/community-comments.repository.js'
import { commentRow, commentsTestContext } from './helpers/community-comments-context.js'

const {
  database,
  prisma,
  repository,
  processor,
  service,
  input,
  fixture,
  create,
  roots,
  publish,
} = commentsTestContext()

// Accepted contract value: a comment body holds at most 280 UTF-16 code units.
const MAX_BODY_UTF16 = 280
// A surrogate-pair emoji spends two UTF-16 units per character.
const EMOJI = '😀'
const EMOJI_AT_LIMIT = EMOJI.repeat(MAX_BODY_UTF16 / EMOJI.length)
const EMOJI_OVER_LIMIT = EMOJI.repeat(MAX_BODY_UTF16 / EMOJI.length + 1)

describe('Story 6.4 comment publication, threading and paging', () => {
  it('keeps pending text author-private and publishes each receipt once', async () => {
    const { userId, postId } = await fixture()
    const other = await fixture()
    const request = input()
    const pending = await create(userId, postId, request)
    expect(pending.status).toBe('pending_screening')
    expect((await roots(other.userId, postId)).items).toEqual([])
    expect(
      (await service.submissions({ userId: other.userId, postId, limit: 20 })).items
    ).toEqual([])
    expect(
      (await service.submissions({ userId, postId, limit: 20 })).items[0]?.body
    ).toBe(request.body)
    await Promise.all([processor.process(pending.id), processor.process(pending.id)])
    expect((await roots(other.userId, postId)).items).toHaveLength(1)
    expect((await create(userId, postId, request)).status).toBe('published')
    const subject = await prisma.communityCommentAnalyticsSubject.findUniqueOrThrow({
      where: { user_id: userId },
    })
    const events = await prisma.communityCommentAnalyticsOutbox.findMany({
      where: { actor: subject.actor },
    })
    // One submission and one publication, despite two concurrent workers and a replay.
    expect(events.map((event) => event.event_type).sort()).toEqual([
      'community_comment_published',
      'community_comment_submitted',
    ])
    await expect(
      create(userId, postId, { ...request, body: 'Changed' })
    ).rejects.toMatchObject({ status: 409 })
  })

  it.each([
    'A\u2028B',
    'A\u2029B',
    '\u200b\u2060',
    '\u061c',
    'a\nb',
    'a\u0001b',
    EMOJI_OVER_LIMIT,
    '  ',
    'e\u0301',
  ])('aligns database and normalized HTTP text for %j', async (raw) => {
    const accepted = communityCommentBodySchema.safeParse(raw)
    const normalized = raw.normalize('NFC').trim()
    const result = await prisma.$queryRaw<
      { valid: boolean }[]
    >`SELECT valid_comment_body(${normalized}) AS valid`
    expect(result[0]?.valid).toBe(accepted.success)
  })

  it('keeps database parity for every runtime Unicode control, format, separator and whitespace code point', async () => {
    const probes: string[] = []
    for (let code = 1; code <= 0x10ffff; code++) {
      const character = String.fromCodePoint(code)
      if (
        /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}\s\u2800]/u.test(
          character
        )
      )
        probes.push(character, `A${character}B`)
    }
    // PostgreSQL text rejects NUL before a CHECK can run; the shared schema rejects it too.
    expect(communityCommentBodySchema.safeParse('A\u0000B').success).toBe(false)
    await expect(
      prisma.$queryRaw`SELECT valid_comment_body(${'A\u0000B'})`
    ).rejects.toThrow('invalid byte sequence')
    const canonical = probes.map((body) => body.normalize('NFC').trim())
    const rows = await prisma.$queryRaw<
      { valid: boolean }[]
    >`SELECT valid_comment_body(body) AS valid FROM unnest(${canonical}::text[]) WITH ORDINALITY AS cases(body, position) ORDER BY position`
    expect(rows.map((row) => row.valid)).toEqual(
      probes.map((body) => communityCommentBodySchema.safeParse(body).success)
    )
  })

  it.each([EMOJI_AT_LIMIT, 'Çok güzel 🌧️', 'élégant', 'حسن', 'a\u200db'])(
    'accepts ordinary Unicode text %j',
    async (body) => {
      const { userId, postId } = await fixture()
      expect((await create(userId, postId, input(body))).body).toBe(body)
    }
  )

  it('enforces same-post immutable roots and one reply level in PostgreSQL', async () => {
    const { userId, postId } = await fixture()
    const other = await fixture()
    const root = await publish(userId, postId)
    const reply = await publish(userId, postId, input('A matching scarf.', root.id))
    await expect(
      create(userId, postId, input('Too deep', reply.id))
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      prisma.communityComment.create({
        data: commentRow({
          post_id: other.postId,
          user_id: userId,
          body: 'Cross post',
          parent_id: root.id,
        }),
      })
    ).rejects.toThrow(/same-post root/)
    await expect(
      prisma.communityComment.update({
        where: { id: reply.id },
        data: { parent_id: null },
      })
    ).rejects.toThrow(/immutable/)
    await expect(
      prisma.communityComment.update({ where: { id: reply.id }, data: { body: null } })
    ).rejects.toThrow(/comment_publication_consistent/)
  })

  it('allows concurrent readers and batches a full page without alias writes', async () => {
    const author = await fixture(),
      viewer = await fixture(),
      other = await fixture()
    const published = await publish(author.userId, author.postId)
    await prisma.communityComment.createMany({
      data: Array.from({ length: 49 }, (_, index) =>
        commentRow({
          post_id: author.postId,
          user_id: author.userId,
          body: 'Synthetic public comment',
          status: 'published',
          publication_sequence: index + 2,
          published_at: new Date(),
        })
      ),
    })
    await prisma.lookbookPost.update({
      where: { id: author.postId },
      data: { comment_publication_sequence: 50 },
    })
    const logged = new PrismaClient({
      datasources: { db: { url: database.url } },
      log: [{ level: 'query', emit: 'event' }],
    })
    const queries: string[] = []
    logged.$on('query', (event) => queries.push(event.query))
    let release: () => void = () => undefined,
      acquired: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const first = repository.withThread(
      viewer.userId,
      author.postId,
      () => Promise.resolve(),
      async () => {
        acquired()
        await gate
      },
      true
    )
    await ready
    let timer: NodeJS.Timeout | undefined
    try {
      const second = new CommunityCommentsRepository(logged).list({
        userId: other.userId,
        postId: author.postId,
        parentId: null,
        limit: 50,
        eligible: () => Promise.resolve(),
      })
      const page = await Promise.race([
        second,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Concurrent reader blocked')), 3000)
        }),
      ])
      expect(page.items).toHaveLength(50)
      expect(page.items[0]?.id).toBe(published.id)
      expect(queries.filter((query) => /CommunityAlias/.test(query))).toHaveLength(1)
      expect(queries.some((query) => /INSERT|UPDATE/.test(query))).toBe(false)
      expect(queries.filter((query) => /GROUP BY/.test(query))).toHaveLength(1)
    } finally {
      clearTimeout(timer)
      release()
      await first
      await logged.$disconnect()
    }
  })

  it('uses publication-order snapshots under concurrent publication and separate reply traversal', async () => {
    const { userId, postId } = await fixture()
    const pending = await Promise.all(
      Array.from({ length: 6 }, () => create(userId, postId))
    )
    await Promise.all(
      pending
        .slice(0, 4)
        .reverse()
        .map((row) => processor.process(row.id))
    )
    const first = await roots(userId, postId, undefined, 2)
    expect(first.items).toHaveLength(2)
    await Promise.all(pending.slice(4).map((row) => processor.process(row.id)))
    const second = await roots(userId, postId, first.nextCursor ?? undefined, 2)
    expect(second.hasNewer).toBe(true)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(4)
    expect((await roots(userId, postId)).items).toHaveLength(6)
    const other = await fixture()
    await expect(
      roots(userId, other.postId, first.nextCursor ?? undefined)
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.list({
        userId,
        postId,
        parentId: first.items[0]!.id,
        cursor: first.nextCursor ?? undefined,
        limit: 20,
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('bounds each cursor page reply count to the snapshot of its first page', async () => {
    const { userId, postId } = await fixture()
    const firstRoot = await publish(userId, postId)
    const secondRoot = await publish(userId, postId)
    const first = await roots(userId, postId, undefined, 1)
    expect(first.items.map((row) => row.id)).toEqual([firstRoot.id])
    await publish(userId, postId, input('A later reply.', secondRoot.id))
    const cursorPage = await roots(userId, postId, first.nextCursor ?? undefined, 1)
    expect(cursorPage.items).toEqual([
      expect.objectContaining({ id: secondRoot.id, replyCount: 0 }),
    ])
    expect(cursorPage.hasNewer).toBe(true)
    // A fresh read takes a new snapshot and sees the reply.
    expect((await roots(userId, postId)).items[1]).toMatchObject({
      id: secondRoot.id,
      replyCount: 1,
    })
  })

  it('projects a deleted root as a tombstone that keeps its replies', async () => {
    const { userId, postId } = await fixture()
    const root = await publish(userId, postId)
    const other = await fixture()
    const reply = await publish(other.userId, postId, input('Lovely coat.', root.id))
    await service.delete({ userId, postId, commentId: root.id, platform: 'web' })
    expect((await roots(other.userId, postId)).items[0]).toMatchObject({
      unavailable: true,
      body: null,
      author: null,
      replyCount: 1,
    })
    expect(
      (await service.list({ userId, postId, parentId: root.id, limit: 20 })).items[0]?.id
    ).toBe(reply.id)
  })

  it('replays a deleted root receipt as author_deleted and refuses deletion by another member', async () => {
    const { userId, postId } = await fixture()
    const request = input()
    const root = await publish(userId, postId, request)
    const other = await fixture()
    await service.delete({ userId, postId, commentId: root.id, platform: 'web' })
    expect((await create(userId, postId, request)).status).toBe('author_deleted')
    await expect(
      service.delete({
        userId: other.userId,
        postId,
        commentId: root.id,
        platform: 'web',
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('cascades a complete thread when its post is deleted', async () => {
    const { userId, postId } = await fixture()
    const root = await publish(userId, postId)
    const other = await fixture()
    await publish(other.userId, postId, input('Lovely coat.', root.id))
    await service.delete({ userId, postId, commentId: root.id, platform: 'web' })
    // Post deletion must cascade a complete thread without a self-FK failure.
    await prisma.lookbookPost.delete({ where: { id: postId } })
    expect(await prisma.communityComment.count({ where: { post_id: postId } })).toBe(0)
  })

  it('withholds a queued reply after root deletion and never exposes deleted pending roots', async () => {
    const { userId, postId } = await fixture()
    const root = await publish(userId, postId)
    const reply = await create(userId, postId, input('Queued reply', root.id))
    await service.delete({ userId, postId, commentId: root.id, platform: 'web' })
    await processor.process(reply.id)
    expect(
      (await service.submissions({ userId, postId, limit: 20 })).items.find(
        (row) => row.id === reply.id
      )?.status
    ).toBe('consent_suspended')
    const neverPublic = await create(userId, postId)
    await service.delete({ userId, postId, commentId: neverPublic.id, platform: 'web' })
    await processor.process(neverPublic.id)
    expect((await roots(userId, postId)).items.map((row) => row.id)).toEqual([root.id])
  })

  it('keeps a comment private and unsequenced when its post is withdrawn before screening finishes', async () => {
    const author = await fixture(),
      member = await fixture()
    await publish(author.userId, author.postId)
    const pending = await create(member.userId, author.postId)
    await prisma.lookbookPost.update({
      where: { id: author.postId },
      data: { status: 'withdrawn' },
    })
    await processor.process(pending.id)
    expect(
      await prisma.communityComment.findUniqueOrThrow({ where: { id: pending.id } })
    ).toMatchObject({
      status: 'consent_suspended',
      body: null,
      publication_sequence: null,
      published_at: null,
    })
    expect(
      await prisma.lookbookPost.findUniqueOrThrow({ where: { id: author.postId } })
    ).toMatchObject({ comment_publication_sequence: 1 })
    expect(
      await prisma.communityCommentReport.count({ where: { comment_id: pending.id } })
    ).toBe(0)
  })

  it.each([
    ['damn', 'held_for_review'],
    ['fuck', 'held_for_review'],
    ['kill yourself', 'blocked'],
  ] as const)(
    'routes %j to exactly %s privately with one content-free intake and audit',
    async (body, status) => {
      const { userId, postId } = await fixture()
      const pending = await publish(userId, postId, input(body))
      expect(
        (await prisma.communityComment.findUniqueOrThrow({ where: { id: pending.id } }))
          .status
      ).toBe(status)
      const report = await prisma.communityCommentReport.findFirstOrThrow({
        where: { comment_id: pending.id },
        include: { audit: true },
      })
      expect(report.content_snapshot).toBeNull()
      expect(report.reporter_id).toBeNull()
      expect(report.audit).toHaveLength(1)
      expect(report.audit[0]?.action).toBe(status)
      expect(JSON.stringify(report.audit)).not.toContain(body)
      expect(
        await prisma.communityCommentReport.count({ where: { comment_id: pending.id } })
      ).toBe(1)
      expect((await roots(userId, postId)).items).toEqual([])
    }
  )
})
