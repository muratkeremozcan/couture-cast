// Story 6.4 owner: the long root community-comments.yaml replies to, seeded for that flow alone.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { cleanupCommunityCommentFixtures } from '../../../packages/testing/src/community-comments-cleanup.js'
import {
  COMMUNITY_COMMENTS_FLOW,
  COMMUNITY_COMMENTS_LONG_ROOT,
  COMMUNITY_COMMENTS_LONG_ROOT_TARGET,
  mobileE2EFlowStateHooks,
  seedCommunityCommentsLongRoot,
} from '../../../scripts/lib/mobile-e2e-flow-state.mjs'
import { CommunityCommentsRepository } from '../src/modules/community/community-comments.repository.js'

// Real-database fixtures under one namespace, removed after the suite, the way the
// location capture harness works against the database the runner itself uses.
const prisma = new PrismaClient({
  datasourceUrl: process.env.INTEGRATION_TEST_DATABASE_URL,
})
const repository = new CommunityCommentsRepository(prisma)
const namespace = `long-root-${randomUUID()}`
const memberId = `${namespace}-member`
const authorId = `${namespace}-author`
const postId = `${namespace}-post`
const target = { postId, authorId }

/** Every top-level flow, discovered the way `run-maestro.mjs` discovers them. */
const flows = readdirSync(resolve(__dirname, '../../../maestro'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
  .map((entry) => `maestro/${entry.name}`)
  .sort()

const hooks = mobileE2EFlowStateHooks({
  locationSentinelKeySuffix: `-${namespace}`,
  cleanupComments: cleanupCommunityCommentFixtures,
  longRootTarget: target,
})

const longRoots = () =>
  prisma.communityComment.findMany({
    where: { post_id: postId, body: COMMUNITY_COMMENTS_LONG_ROOT },
  })
const memberRoots = () =>
  repository.list({
    userId: memberId,
    postId,
    parentId: null,
    limit: 20,
    eligible: () => Promise.resolve(),
  })

beforeAll(async () => {
  for (const id of [memberId, authorId])
    await prisma.user.create({ data: { id, email: `${id}@example.com` } })
  await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({
        id: postId,
        userId: authorId,
        status: 'published',
        publishedAt: new Date(),
        altTextConfirmedAt: new Date(),
      })
    ),
  })
})

afterAll(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${memberId},${authorId}]::text[],ARRAY[${postId}]::text[],true)`
      const comments = await tx.communityComment.findMany({
        where: { post_id: postId },
        select: { id: true },
      })
      await cleanupCommunityCommentFixtures(
        tx,
        comments.map((row) => row.id)
      )
      await tx.savedLocation.deleteMany({ where: { user_id: memberId } })
      await tx.lookbookPost.deleteMany({ where: { id: postId } })
      await tx.user.deleteMany({ where: { id: { in: [memberId, authorId] } } })
    })
  } finally {
    await prisma.$disconnect()
  }
})

describe('Story 6.4 community comments long root fixture', () => {
  it('is a fixed comment-sized body that keeps the flow regexes literal, on the seeded post by a seeded adult', () => {
    expect(COMMUNITY_COMMENTS_LONG_ROOT).toHaveLength(270)
    expect(COMMUNITY_COMMENTS_LONG_ROOT).toMatch(/^[A-Za-z0-9 ]+$/)
    expect(COMMUNITY_COMMENTS_LONG_ROOT_TARGET).toEqual({
      postId: 'lookbook-5',
      authorId: 'guardian-2',
    })
  })

  it('is seeded for no other flow', async () => {
    expect(flows).toContain(COMMUNITY_COMMENTS_FLOW)
    for (const flow of flows.filter((path) => path !== COMMUNITY_COMMENTS_FLOW)) {
      await hooks[flow]?.before(prisma, memberId)
      expect(await longRoots(), flow).toEqual([])
      await hooks[flow]?.after(prisma, memberId)
    }
    expect((await memberRoots()).items).toEqual([])
  })

  it('publishes one long root the member sees across watchdog retries, then removes it', async () => {
    const hook = hooks[COMMUNITY_COMMENTS_FLOW]
    expect(hook).toBeDefined()

    // The initial attempt and the single watchdog retry each run `before`.
    await hook!.before(prisma, memberId)
    await hook!.before(prisma, memberId)

    const seeded = await longRoots()
    expect(seeded).toHaveLength(1)
    const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    expect(seeded[0]).toMatchObject({
      user_id: authorId,
      parent_id: null,
      status: 'published',
      publication_sequence: post.comment_publication_sequence,
    })
    expect((await memberRoots()).items).toEqual([
      expect.objectContaining({
        id: seeded[0]!.id,
        parentId: null,
        body: COMMUNITY_COMMENTS_LONG_ROOT,
        isOwn: false,
        unavailable: false,
      }),
    ])

    await hook!.after(prisma, memberId)
    expect(await longRoots()).toEqual([])
    expect((await memberRoots()).items).toEqual([])

    // A second removal, as after a flow whose seeding never ran, changes nothing.
    await hook!.after(prisma, memberId)
    expect(await longRoots()).toEqual([])
  })

  it('names the seed command when the post or author is missing, and writes nothing', async () => {
    const before = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    for (const missing of [
      { postId: `${namespace}-missing-post`, authorId },
      { postId, authorId: `${namespace}-missing-author` },
    ]) {
      await expect(
        seedCommunityCommentsLongRoot(prisma, cleanupCommunityCommentFixtures, missing)
      ).rejects.toThrow('run `npm run db:seed`')
    }
    expect(await longRoots()).toEqual([])
    expect(
      await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    ).toEqual(before)
  })
})
