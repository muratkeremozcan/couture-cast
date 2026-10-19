import 'reflect-metadata'
import request from 'supertest'
import { Test } from '@nestjs/testing'
import { CommunityController } from '../src/modules/community/community.controller.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import {
  communityReactionResponseSchema,
  type SetCommunityReactionInput,
} from '@couture/api-client/contracts/http'
import { PostHogService } from '../src/posthog/posthog.service.js'
import { PrismaClient } from '@prisma/client'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityReactionOutboxDispatcher } from '../src/modules/community/community-reaction.outbox.js'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'

vi.mock('../src/workers/base.worker.js', () => ({
  defaultWorkerOptions: () => ({}),
  createWorker: () => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    client: Promise.resolve({
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    }),
  }),
}))
vi.mock('../src/modules/community/community-moderation.outbox.js', () => ({
  CommunityModerationOutboxDispatcher: class {
    dispatchPending = vi.fn().mockResolvedValue(undefined)
  },
}))

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: database.url,
    },
  },
})
const repository = new CommunityRepository(prisma)
const namespace = `community-reactions-${randomUUID()}`
const guardian = new GuardianService(
  { capture: vi.fn() },
  prisma,
  { markTeenAccessRevoked: vi.fn(), markTeenAccessGranted: vi.fn() } as never,
  { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
)
const input = (
  selection: SetCommunityReactionInput['selection'],
  baseRevision = 0
): SetCommunityReactionInput => ({ selection, baseRevision, mutationId: randomUUID() })
async function fixture(birthdate = '1990-01-01T00:00:00Z', client = prisma) {
  const user = await client.user.create({
    data: {
      email: `${namespace}-${randomUUID()}@synthetic.test`,
      profile: {
        create: {
          birthdate: new Date(birthdate),
          preferences: { compliance: { accountStatus: 'active' } },
        },
      },
    },
  })
  const post = await client.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({
        id: `${namespace}-${randomUUID()}`,
        userId: user.id,
        status: 'published',
        publishedAt: new Date('2025-06-01T00:00:00Z'),
        altTextConfirmedAt: new Date('2025-05-31T00:00:00Z'),
      })
    ),
  })
  return { userId: user.id, postId: post.id }
}
function mutate(userId: string, postId: string, intent: SetCommunityReactionInput) {
  return repository.setReaction({
    userId,
    postId,
    input: intent,
    platform: 'web',
    assertEligible: async (tx, participation) => {
      if (participation && intent.selection !== null)
        await guardian.assertWardrobeUploadAllowed(userId, undefined, tx)
    },
  })
}
beforeAll(async () => {
  await database.migrate()
  await prisma.$queryRaw`SELECT 1 FROM "CommunityReaction" LIMIT 1`
}, 30_000)
beforeEach(async () => {
  // This connection belongs to this file's disposable database. Each delivery
  // scenario starts with its own backlog, independent of preceding reactions.
  await prisma.communityReactionOutbox.deleteMany()
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  try {
    await prisma.$disconnect()
  } finally {
    // Database disposal also removes immutable guardian audit records on failure.
    await database.drop()
  }
})

describe('Story 6.3 durable reaction semantics', () => {
  it('preserves reactions, receipts, and queued events through parent identity updates', async () => {
    const { userId, postId } = await fixture()
    const intent = input('applause')
    await mutate(userId, postId, intent)
    const event = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    const before = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    const nextUserId = randomUUID()
    const nextPostId = `${namespace}-${randomUUID()}`
    await prisma.user.update({ where: { id: userId }, data: { id: nextUserId } })
    await prisma.lookbookPost.update({ where: { id: postId }, data: { id: nextPostId } })
    const state = await prisma.communityReaction.findUniqueOrThrow({
      where: { user_id_post_id: { user_id: nextUserId, post_id: nextPostId } },
    })
    expect(state).toMatchObject({ selection: 'applause', revision: 1 })
    expect(
      await prisma.communityReactionReceipt.findUniqueOrThrow({
        where: {
          user_id_mutation_id: { user_id: nextUserId, mutation_id: intent.mutationId },
        },
      })
    ).toMatchObject({ post_id: nextPostId, selection: 'applause', base_revision: 0 })
    expect(
      await prisma.communityReactionOutbox.findUniqueOrThrow({ where: { id: event.id } })
    ).toMatchObject({ user_id: nextUserId, post_id: nextPostId, payload: event.payload })
    const after = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: nextPostId },
    })
    expect(after.reaction_generation).toBeGreaterThan(before.reaction_generation)
    expect(await mutate(nextUserId, nextPostId, intent)).toMatchObject({
      summary: { total: 1, viewerReaction: 'applause', revision: 1 },
    })
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: nextPostId } })
    ).toBe(1)
    const constraints = await prisma.$queryRaw<
      { conname: string; confupdtype: string; confdeltype: string }[]
    >`
      SELECT conname, confupdtype::text, confdeltype::text FROM pg_constraint
      WHERE conrelid IN ('"CommunityReaction"'::regclass, '"CommunityReactionReceipt"'::regclass, '"CommunityReactionOutbox"'::regclass) AND contype = 'f'
      ORDER BY conname
    `
    expect(constraints).toHaveLength(6)
    expect(
      constraints.every((row) => row.confupdtype === 'c' && row.confdeltype === 'c')
    ).toBe(true)
  })

  it('adds, replaces, retracts, and fences delayed first attempts and retained retries', async () => {
    const { userId, postId } = await fixture()
    const first = input('applause')
    expect(await mutate(userId, postId, first)).toMatchObject({
      summary: {
        counts: { applause: 1, love: 0, inspiration: 0 },
        total: 1,
        revision: 1,
        viewerReaction: 'applause',
      },
    })
    expect(await mutate(userId, postId, input('love', 1))).toMatchObject({
      summary: { counts: { applause: 0, love: 1, inspiration: 0 }, revision: 2 },
    })
    expect(await mutate(userId, postId, input(null, 2))).toMatchObject({
      summary: { total: 0, revision: 3, viewerReaction: null },
    })
    expect(await mutate(userId, postId, first)).toMatchObject({
      summary: { total: 0, revision: 3, viewerReaction: null },
    })
    await expect(mutate(userId, postId, input('inspiration', 1))).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      mutate(userId, postId, { ...first, selection: 'love' })
    ).rejects.toMatchObject({ status: 409 })
    await prisma.communityReactionReceipt.deleteMany({ where: { user_id: userId } })
    await expect(mutate(userId, postId, first)).rejects.toMatchObject({ status: 409 })
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: postId } })
    ).toBe(3)
  })

  it('retains a null-state revision on an initial retraction', async () => {
    const { userId, postId } = await fixture()
    expect(await mutate(userId, postId, input(null))).toMatchObject({
      summary: { total: 0, revision: 1 },
    })
    await expect(mutate(userId, postId, input('love'))).rejects.toMatchObject({
      status: 409,
    })
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: postId } })
    ).toBe(0)
  })

  it('serializes competing requests and produces coherent batch snapshots', async () => {
    const { userId, postId } = await fixture()
    const competing = await Promise.allSettled([
      mutate(userId, postId, input('love')),
      mutate(userId, postId, input('applause')),
    ])
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const other = await fixture()
    await mutate(other.userId, postId, input('inspiration'))
    const summary = (await repository.reactionSummaries([postId], userId)).get(postId)
    expect(summary?.total).toBe(2)
    expect(
      Object.values(summary?.counts ?? {}).reduce((sum, value) => sum + value, 0)
    ).toBe(2)
    expect(
      await prisma.communityReaction.count({
        where: { post_id: postId, selection: { not: null } },
      })
    ).toBe(2)
  })

  it('limits new mutation IDs to sixty while accepted retries bypass quota', async () => {
    const { userId, postId } = await fixture()
    const first = input('love')
    await mutate(userId, postId, first)
    for (let revision = 1; revision < 60; revision += 1)
      await mutate(userId, postId, input(revision % 2 ? 'applause' : 'love', revision))
    expect(await mutate(userId, postId, input(null, 60))).toHaveProperty(
      'retryAfterSeconds'
    )
    expect(await mutate(userId, postId, first)).toMatchObject({
      summary: { revision: 60, total: 1 },
    })
  })

  it('refuses missing age, under-13 and unconsented teens; permits retraction after consent loss', async () => {
    for (const age of [null, '2020-01-01T00:00:00Z', '2012-01-01T00:00:00Z']) {
      const { userId, postId } = await fixture(age ?? undefined)
      if (age === null)
        await prisma.userProfile.update({
          where: { user_id: userId },
          data: { birthdate: null },
        })
      await expect(mutate(userId, postId, input('love'))).rejects.toMatchObject({
        status: 403,
      })
    }
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    await prisma.userProfile.update({
      where: { user_id: userId },
      data: { birthdate: new Date('2012-01-01T00:00:00Z') },
    })
    await expect(mutate(userId, postId, input('applause', 1))).rejects.toMatchObject({
      status: 403,
    })
    expect(await mutate(userId, postId, input(null, 1))).toMatchObject({
      summary: { total: 0, revision: 2 },
    })
  })

  it('withdraws a teens counted votes atomically when the last consent is revoked', async () => {
    const owner = await fixture()
    const teen = await fixture('2012-01-01T00:00:00Z')
    await prisma.guardianConsent.create({
      data: { guardian_id: owner.userId, teen_id: teen.userId, status: 'granted' },
    })
    const firstIntent = input('inspiration')
    await mutate(teen.userId, owner.postId, firstIntent)
    const before = (await repository.reactionSummaries([owner.postId], teen.userId)).get(
      owner.postId
    )
    await guardian.revokeConsent(owner.userId, teen.userId)
    const after = (await repository.reactionSummaries([owner.postId], teen.userId)).get(
      owner.postId
    )
    expect(after).toMatchObject({ total: 0, viewerReaction: null, revision: 2 })
    expect(after?.generation).toBeGreaterThan(before?.generation ?? 0)
    expect(await mutate(teen.userId, owner.postId, firstIntent)).toMatchObject({
      summary: { total: 0, viewerReaction: null, revision: 2 },
    })
  })

  it('serializes consent revocation behind an in-flight accepted reaction', async () => {
    const owner = await fixture()
    const teen = await fixture('2012-01-01T00:00:00Z')
    await prisma.guardianConsent.create({
      data: { guardian_id: owner.userId, teen_id: teen.userId, status: 'granted' },
    })
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = new Promise<void>((resolve) => {
      entered = resolve
    })
    const reaction = repository.setReaction({
      userId: teen.userId,
      postId: owner.postId,
      input: input('love'),
      platform: 'web',
      assertEligible: async (tx, participation) => {
        if (!participation) return
        entered()
        await gate
        await guardian.assertWardrobeUploadAllowed(teen.userId, undefined, tx)
      },
    })
    await locked
    const revocation = guardian.revokeConsent(owner.userId, teen.userId)
    // Wait until PostgreSQL confirms the revoke transaction is waiting for the member lock.
    await vi.waitFor(async () => {
      const waiting = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT COUNT(*) AS count FROM pg_stat_activity WHERE wait_event = 'advisory' AND query LIKE '%community_member:%'`
      expect(Number(waiting[0]?.count)).toBeGreaterThan(0)
    })
    release()
    await reaction
    await revocation
    expect(
      (await repository.reactionSummaries([owner.postId], teen.userId)).get(owner.postId)
    ).toMatchObject({ total: 0, viewerReaction: null, revision: 2 })
  })

  it('hides summaries on visibility changes and purges retained post rows on erasure', async () => {
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    const original = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: postId },
    })
    await prisma.lookbookPost.update({
      where: { id: postId },
      data: { status: 'flagged' },
    })
    expect((await repository.reactionSummaries([postId], userId)).size).toBe(0)
    await expect(mutate(userId, postId, input(null, 1))).rejects.toMatchObject({
      status: 404,
    })
    const hidden = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    expect(hidden.reaction_generation).toBeGreaterThan(original.reaction_generation)
    await repository.requestErasureForUser(userId, new Date())
    expect(await prisma.communityReaction.count({ where: { post_id: postId } })).toBe(0)
    expect(
      await prisma.communityReactionReceipt.count({ where: { post_id: postId } })
    ).toBe(0)
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: postId } })
    ).toBe(0)
    expect(await prisma.lookbookPost.count({ where: { id: postId } })).toBe(1)
  })

  it('invalidates surviving aggregates on member deletion and purges erased posts through database triggers', async () => {
    const author = await fixture()
    const member = await fixture()
    await mutate(member.userId, author.postId, input('love'))
    const before = (
      await repository.reactionSummaries([author.postId], author.userId)
    ).get(author.postId)
    await prisma.userProfile.delete({ where: { user_id: member.userId } })
    await prisma.user.delete({ where: { id: member.userId } })
    const after = (
      await repository.reactionSummaries([author.postId], author.userId)
    ).get(author.postId)
    expect(after?.total).toBe(0)
    expect(after?.generation).toBeGreaterThan(before?.generation ?? 0)
    await mutate(author.userId, author.postId, input('inspiration'))
    await repository.withdrawPostAndRequestErasure(author.postId, new Date())
    expect(await prisma.lookbookPost.count({ where: { id: author.postId } })).toBe(1)
    expect(
      await prisma.communityReaction.count({ where: { post_id: author.postId } })
    ).toBe(0)
    expect(
      await prisma.communityReactionReceipt.count({ where: { post_id: author.postId } })
    ).toBe(0)
    expect(
      await prisma.communityReactionOutbox.count({ where: { post_id: author.postId } })
    ).toBe(0)
  })

  it('serializes a new guardian grant and repeated revocation without restoring withdrawn votes', async () => {
    const owner = await fixture()
    const teen = await fixture('2012-01-01T00:00:00Z')
    await prisma.userProfile.update({
      where: { user_id: teen.userId },
      data: {
        preferences: { compliance: { accountStatus: 'pending_guardian_consent' } },
      },
    })
    const invitation = await guardian.inviteGuardian(
      teen.userId,
      `${namespace}-second-${randomUUID()}@synthetic.test`
    )
    await prisma.guardianConsent.create({
      data: { guardian_id: owner.userId, teen_id: teen.userId, status: 'granted' },
    })
    await prisma.userProfile.update({
      where: { user_id: teen.userId },
      data: { preferences: { compliance: { accountStatus: 'active' } } },
    })
    await mutate(teen.userId, owner.postId, input('love'))
    const token = new URL(invitation.invitationLink).searchParams.get('token')
    if (!token) throw new Error('Invitation token missing')
    const [revocation] = await Promise.all([
      guardian.revokeConsent(owner.userId, teen.userId),
      guardian.acceptInvitation(token),
    ])
    expect(
      await prisma.guardianConsent.count({
        where: { teen_id: teen.userId, status: 'granted', revoked_at: null },
      })
    ).toBe(1)
    const current = (await repository.reactionSummaries([owner.postId], teen.userId)).get(
      owner.postId
    )
    expect(current?.total).toBe(revocation.remainingActiveGuardians === 0 ? 0 : 1)
    await expect(guardian.revokeConsent(owner.userId, teen.userId)).rejects.toMatchObject(
      { status: 404 }
    )
    await expect(guardian.acceptInvitation(token)).rejects.toMatchObject({ status: 400 })
  })

  it('recovers analytics delivery with stable insertion IDs and privacy-safe properties', async () => {
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    const capture = vi.fn().mockImplementation(() => {
      throw new Error('analytics unavailable')
    })
    const telemetry = new TelemetryService(prisma, {
      capture: vi.fn(),
      captureAcknowledged: capture,
    })
    const dispatcher = new CommunityReactionOutboxDispatcher(prisma, telemetry)
    await dispatcher.dispatchPending()
    const pending = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    expect(pending.delivered_at).toBeNull()
    expect(
      (await repository.reactionSummaries([postId], userId)).get(postId)?.total
    ).toBe(1)
    await prisma.communityReactionOutbox.update({
      where: { id: pending.id },
      data: { next_attempt_at: new Date(0) },
    })
    capture.mockImplementation(() => undefined)
    await dispatcher.dispatchPending()
    const delivered = await prisma.communityReactionOutbox.findUniqueOrThrow({
      where: { id: pending.id },
    })
    expect(delivered.delivered_at).not.toBeNull()
    const event = capture.mock.calls.find(
      (call) =>
        (call[0] as { properties: { $insert_id: string } }).properties.$insert_id ===
        pending.id
    )?.[0] as { distinctId: string; properties: Record<string, unknown> }
    expect(event.distinctId).not.toBe(userId)
    expect(event.properties).toMatchObject({
      $insert_id: pending.id,
      $ip: null,
      is_self: true,
    })
    expect(JSON.stringify(event)).not.toContain(userId)
    expect(await prisma.telemetryEvent.count({ where: { id: pending.id } })).toBe(1)
    await prisma.telemetryEvent.delete({ where: { id: pending.id } })
  })
  it('keeps delivery pending across real HTTP ingestion failures and accepts only a successful acknowledgement', async () => {
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('applause'))
    const row = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    const bodies: string[] = []
    let status = 503
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        bodies.push(body)
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ status: status === 200 ? 1 : 0 }))
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('No local ingestion port')
    const oldKey = process.env.POSTHOG_API_KEY
    const oldHost = process.env.POSTHOG_HOST
    process.env.POSTHOG_API_KEY = 'phc_synthetic_local_only'
    process.env.POSTHOG_HOST = `http://127.0.0.1:${address.port}`
    const adapter = new PostHogService()
    try {
      const dispatcher = new CommunityReactionOutboxDispatcher(
        prisma,
        new TelemetryService(prisma, adapter)
      )
      await dispatcher.dispatchPending()
      expect(
        (
          await prisma.communityReactionOutbox.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).delivered_at
      ).toBeNull()
      expect(
        (await repository.reactionSummaries([postId], userId)).get(postId)?.total
      ).toBe(1)
      status = 200
      await prisma.communityReactionOutbox.update({
        where: { id: row.id },
        data: { next_attempt_at: new Date(0) },
      })
      await dispatcher.dispatchPending()
      expect(
        (
          await prisma.communityReactionOutbox.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).delivered_at
      ).not.toBeNull()
      const attempts = bodies
        .map(
          (body) =>
            JSON.parse(body) as {
              uuid: string
              timestamp: string
              distinct_id: string
              properties: Record<string, unknown>
            }
        )
        .filter((body) => body.uuid === row.id)
      expect(attempts).toHaveLength(2)
      expect(attempts[0]?.uuid).toBe(attempts[1]?.uuid)
      expect(attempts[0]?.timestamp).toBe(row.created_at.toISOString())
      expect(attempts[1]?.timestamp).toBe(row.created_at.toISOString())
      expect(attempts[0]?.distinct_id).not.toBe(userId)
      expect(attempts[0]?.properties).toMatchObject({
        $ip: null,
        $geoip_disable: true,
        $process_person_profile: false,
      })
      await prisma.telemetryEvent.deleteMany({ where: { id: row.id } })
    } finally {
      adapter.onApplicationShutdown()
      if (oldKey === undefined) delete process.env.POSTHOG_API_KEY
      else process.env.POSTHOG_API_KEY = oldKey
      if (oldHost === undefined) delete process.env.POSTHOG_HOST
      else process.env.POSTHOG_HOST = oldHost
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })
  it('uses the actual guarded HTTP route for revoked teen retraction and rejects participation', async () => {
    const owner = await fixture()
    const teen = await fixture('2012-01-01T00:00:00Z')
    await prisma.guardianConsent.create({
      data: { guardian_id: owner.userId, teen_id: teen.userId, status: 'granted' },
    })
    await mutate(teen.userId, owner.postId, input('love'))
    await guardian.revokeConsent(owner.userId, teen.userId)
    const flags = { getFeatureFlag: vi.fn().mockResolvedValue(true) }
    const service = new CommunityService(
      repository,
      flags as never,
      {} as never,
      {} as never,
      {} as never,
      guardian
    )
    const module = await Test.createTestingModule({
      controllers: [CommunityController],
      providers: [
        { provide: CommunityService, useValue: service },
        {
          provide: GuardianConsentStateService,
          useValue: { canTeenAccess: vi.fn().mockResolvedValue(false) },
        },
        {
          provide: AccessTokenIdentityService,
          useValue: {
            resolveIdentity: vi
              .fn()
              .mockResolvedValue({ userId: teen.userId, role: 'teen' }),
          },
        },
      ],
    }).compile()
    const app = module.createNestApplication()
    app.useLogger(false)
    await app.init()
    try {
      const url = `/api/v1/community/posts/${owner.postId}/reaction`
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .put(url)
        .send(input(null, 2))
        .expect(401)
      const removal = await request(app.getHttpServer() as Parameters<typeof request>[0])
        .put(url)
        .set('Authorization', 'Bearer synthetic-token')
        .set('x-couture-platform', 'web')
        .send(input(null, 2))
        .expect(200)
      expect(
        communityReactionResponseSchema.parse(removal.body as unknown).data
      ).toMatchObject({
        total: 0,
        viewerReaction: null,
        revision: 3,
      })
      for (const selection of ['applause', 'love'] as const) {
        await request(app.getHttpServer() as Parameters<typeof request>[0])
          .put(url)
          .set('Authorization', 'Bearer synthetic-token')
          .set('x-couture-platform', 'web')
          .send(input(selection, 3))
          .expect(403)
      }
    } finally {
      await app.close()
    }
  })

  it('refuses fresh adds and replacements through the HTTP guard during a posting freeze', async () => {
    const owner = await fixture()
    const member = await fixture()
    await mutate(member.userId, owner.postId, input('love'))
    const before = await repository.reactionSummaries(
      [owner.postId, member.postId],
      member.userId
    )
    const service = new CommunityService(
      repository,
      {
        getFeatureFlag: vi.fn((key: string) =>
          Promise.resolve(key === 'community_read_enabled')
        ),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      guardian
    )
    const module = await Test.createTestingModule({
      controllers: [CommunityController],
      providers: [
        { provide: CommunityService, useValue: service },
        {
          provide: GuardianConsentStateService,
          useValue: { canTeenAccess: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: AccessTokenIdentityService,
          useValue: {
            resolveIdentity: vi
              .fn()
              .mockResolvedValue({ userId: member.userId, role: 'adult' }),
          },
        },
      ],
    }).compile()
    const app = module.createNestApplication()
    app.useLogger(false)
    await app.init()
    try {
      for (const [postId, revision] of [
        [member.postId, 0],
        [owner.postId, 1],
      ] as const) {
        await request(app.getHttpServer() as Parameters<typeof request>[0])
          .put(`/api/v1/community/posts/${postId}/reaction`)
          .set('Authorization', 'Bearer synthetic-token')
          .set('x-couture-platform', 'web')
          .send(input('applause', revision))
          .expect(503)
      }
      expect(
        await repository.reactionSummaries([owner.postId, member.postId], member.userId)
      ).toEqual(before)
    } finally {
      await app.close()
    }
  })

  it('erases member reactions on another retained authors public post without deleting either member', async () => {
    const author = await fixture()
    const member = await fixture()
    await mutate(member.userId, author.postId, input('love'))
    const before = (
      await repository.reactionSummaries([author.postId], author.userId)
    ).get(author.postId)!
    const counts = async () => [
      await prisma.communityReaction.count({ where: { user_id: member.userId } }),
      await prisma.communityReactionReceipt.count({ where: { user_id: member.userId } }),
      await prisma.communityReactionOutbox.count({ where: { user_id: member.userId } }),
    ]
    expect(await counts()).toEqual([1, 1, 1])
    await repository.requestErasureForUser(member.userId, new Date())
    expect(await counts()).toEqual([0, 0, 0])
    expect(
      await prisma.user.count({ where: { id: { in: [author.userId, member.userId] } } })
    ).toBe(2)
    expect(
      await prisma.lookbookPost.findUniqueOrThrow({ where: { id: author.postId } })
    ).toMatchObject({ status: 'published', erasure_requested_at: null })
    const after = (
      await repository.reactionSummaries([author.postId], author.userId)
    ).get(author.postId)!
    expect(before.total).toBe(1)
    expect(after.total).toBe(0)
    expect(after.generation).toBeGreaterThan(before.generation)
  })

  it('caps indexed retention batches and continues cleanup while delivery exhausts each sweep', async () => {
    const { userId, postId } = await fixture()
    const [clock] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now()`
    let sweepNow = clock!.now.getTime()
    vi.spyOn(Date, 'now').mockImplementation(() => sweepNow)
    const expired = new Date(sweepNow - 31 * 24 * 60 * 60 * 1000)
    const cutoff = new Date(sweepNow - 30 * 24 * 60 * 60 * 1000)
    await prisma.communityReactionReceipt.createMany({
      data: Array.from({ length: 205 }, () => ({
        user_id: userId,
        post_id: postId,
        mutation_id: randomUUID(),
        selection: 'love',
        base_revision: 0,
        created_at: expired,
      })),
    })
    await prisma.communityReactionOutbox.createMany({
      data: Array.from({ length: 205 }, () => ({
        id: randomUUID(),
        user_id: userId,
        post_id: postId,
        event_type: 'community_reaction_added',
        payload: {},
        created_at: expired,
        delivered_at: expired,
      })),
    })
    const dueIds = Array.from({ length: 4 }, () => randomUUID())
    await prisma.communityReactionOutbox.createMany({
      data: dueIds.map((id) => ({
        id,
        user_id: userId,
        post_id: postId,
        event_type: 'community_reaction_added',
        payload: {},
        created_at: expired,
        next_attempt_at: new Date(0),
      })),
    })
    const captureReactionEvent = vi.fn(() => {
      sweepNow += 1050
      return Promise.resolve()
    })
    const dispatcher = new CommunityReactionOutboxDispatcher(prisma, {
      captureReactionEvent,
    } as unknown as TelemetryService)
    for (const remaining of [105, 5, 0]) {
      await dispatcher.dispatchPending()
      expect(
        await prisma.communityReactionReceipt.count({
          where: { user_id: userId, created_at: { lt: cutoff } },
        })
      ).toBe(remaining)
      expect(
        await prisma.communityReactionOutbox.count({
          where: { user_id: userId, delivered_at: { lt: cutoff } },
        })
      ).toBe(remaining)
    }
    expect(captureReactionEvent).toHaveBeenCalledTimes(3)
    expect(
      await prisma.communityReactionOutbox.count({
        where: { id: { in: dueIds }, delivered_at: null, attempts: 0 },
      })
    ).toBe(1)
  })

  it('refuses a report while erasure is pending', async () => {
    const owner = await fixture()
    const reporter = await fixture()
    await prisma.lookbookPost.update({
      where: { id: owner.postId },
      data: { erasure_requested_at: new Date() },
    })
    expect(
      await repository.recordReport({
        postId: owner.postId,
        reporterId: reporter.userId,
        reason: 'spam',
        abuseLimit: 5,
        slaHours: 24,
        subjectAlias: 'synthetic-alias',
      })
    ).toEqual({ kind: 'post_not_visible' })
    expect(
      await prisma.communityPostReport.count({ where: { post_id: owner.postId } })
    ).toBe(0)
  })

  it('releases a one-connection pool during slow delivery, bounds a sweep, and recovers an expired lease', async () => {
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    const row = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    await mutate(userId, postId, input('applause', 1))
    const second = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId, id: { not: row.id } },
    })
    await prisma.communityReactionOutbox.update({
      where: { id: row.id },
      data: { next_attempt_at: new Date(0) },
    })
    await prisma.communityReactionOutbox.update({
      where: { id: second.id },
      data: { next_attempt_at: new Date(1) },
    })
    const url = new URL(database.url)
    url.searchParams.set('connection_limit', '1')
    url.searchParams.set('pool_timeout', '1')
    const single = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const capture = vi.fn().mockImplementation(async () => {
      entered()
      await gate
      throw new Error('sink unavailable')
    })
    const dispatcher = new CommunityReactionOutboxDispatcher(
      single,
      new TelemetryService(single, { capture: vi.fn(), captureAcknowledged: capture })
    )
    const [clock] = await single.$queryRaw<{ now: Date }[]>`SELECT now()`
    let sweepNow = clock!.now.getTime()
    vi.spyOn(Date, 'now').mockImplementation(() => sweepNow)
    const dispatch = dispatcher.dispatchPending()
    try {
      await started
      // The telemetry upsert and this read must both acquire the sole connection.
      expect(await single.telemetryEvent.count({ where: { id: row.id } })).toBe(1)
      sweepNow += 1100
      release()
      await dispatch
      expect(capture).toHaveBeenCalledTimes(1)
      expect(
        await single.communityReactionOutbox.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).toMatchObject({ attempts: 0, lease_id: null, delivered_at: null })
      expect(
        await single.communityReactionOutbox.findUniqueOrThrow({ where: { id: row.id } })
      ).toMatchObject({ delivered_at: null, lease_id: null, attempts: 1 })
      await single.communityReactionOutbox.update({
        where: { id: row.id },
        data: {
          lease_id: randomUUID(),
          // SQL clock and eligibility share the actual database timestamp.
          lease_expires_at: new Date(clock!.now.getTime() - 1),
          next_attempt_at: new Date(0),
        },
      })
      capture.mockResolvedValue(undefined)
      await dispatcher.dispatchPending()
      expect(
        await single.communityReactionOutbox.findUniqueOrThrow({ where: { id: row.id } })
      ).toMatchObject({
        delivered_at: expect.any(Date) as unknown,
        attempts: 2,
        lease_id: null,
      })
    } finally {
      release()
      await dispatch
      await single.$disconnect()
      await prisma.telemetryEvent.deleteMany({
        where: { id: { in: [row.id, second.id] } },
      })
    }
  })
  it('delivers a durable reaction row through the runtime sweep', async () => {
    const { createCommunityWorkerRuntime } = await import(
      '../src/modules/community/community-worker-runtime.js'
    )
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    const row = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    await prisma.communityReactionOutbox.update({
      where: { id: row.id },
      data: { next_attempt_at: new Date(0) },
    })
    const acknowledged = vi.fn().mockResolvedValue(undefined)
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService: new TelemetryService(prisma, {
        capture: vi.fn(),
        captureAcknowledged: acknowledged,
      }),
      engine: { screenImage: vi.fn(), screenText: vi.fn(), moderatePost: vi.fn() },
      meter: {
        recordScreenerReadiness: vi.fn(),
        recordScreening: vi.fn(),
        recordAttemptFailure: vi.fn(),
        recordModelHealth: vi.fn(),
      },
    })
    try {
      await runtime.sweeps.dispatchPending()
      expect(
        (
          await prisma.communityReactionOutbox.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).delivered_at
      ).toBeInstanceOf(Date)
      expect(acknowledged).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({ $insert_id: row.id }) as unknown,
        })
      )
    } finally {
      await runtime.close()
      await prisma.telemetryEvent.deleteMany({ where: { id: row.id } })
    }
  })
})
