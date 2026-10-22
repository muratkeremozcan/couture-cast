import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import 'reflect-metadata'
import { ServiceUnavailableException } from '@nestjs/common'
import { CommunityCommentsProcessor } from '../src/modules/community/community-comments.processor.js'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { PrismaClient } from '@prisma/client'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import {
  createUser,
  createTeenUser,
  persistUser,
  createLookbookPost,
  buildLookbookPostCreateInput,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityMaintenanceService } from '../src/modules/community/community-maintenance.service.js'
import { CommunityModerationProcessor } from '../src/modules/community/community-moderation.processor.js'
import { FixtureCommunityModerationEngine } from '../src/modules/community/community-moderation.engine.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
beforeAll(() => database.migrate(), 30000)
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})
function barrier() {
  let release!: () => void
  const promise = new Promise<void>((done) => {
    release = done
  })
  return { promise, release }
}
async function fixture() {
  const user = await persistUser(prisma, createUser())
  const bytes = await sharp({
    create: { width: 512, height: 640, channels: 3, background: '#112233' },
  })
    .jpeg({ quality: 100 })
    .toBuffer()
  const post = await prisma.lookbookPost.create({
    data: {
      ...buildLookbookPostCreateInput(
        createLookbookPost({ userId: user.id, status: 'pending_review' })
      ),
      image_checksum: createHash('sha256').update(bytes).digest('hex'),
      image_byte_size: bytes.length,
      image_content_type: 'image/jpeg',
    },
  })
  await prisma.communityModerationOutbox.create({ data: { post_id: post.id } })
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
  return { user, post, bytes }
}
const telemetry = { captureEvent: () => Promise.resolve() } as unknown as TelemetryService

describe('Story 6.5 cross-feature privacy producers', () => {
  it('R06 guardian revocation cannot recreate private artifacts in the new generation', async () => {
    const guardian = await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
    const teen = await persistUser(
      prisma,
      createTeenUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
    await prisma.guardianConsent.create({
      data: { guardian_id: guardian.id, teen_id: teen.id, status: 'granted' },
    })
    const post = await prisma.lookbookPost.create({
      data: buildLookbookPostCreateInput(
        createLookbookPost({ userId: guardian.id, status: 'published' })
      ),
    })
    const comment = await prisma.communityComment.create({
      data: {
        post_id: post.id,
        user_id: teen.id,
        status: 'published',
        body: 'Synthetic teen contribution',
        published_at: new Date(),
        publication_sequence: 1,
        locale: 'en-US',
        platform: 'web',
      },
    })
    const service = new GuardianService(
      { capture: vi.fn() },
      prisma,
      { markTeenAccessRevoked: vi.fn() } as never,
      { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
    )
    await service.revokeConsent(guardian.id, teen.id)
    expect(
      await prisma.communityComment.findUnique({ where: { id: comment.id } })
    ).toMatchObject({ status: 'consent_suspended', body: null })
    const head = await prisma.communityStreamHead.findUniqueOrThrow({
      where: { owner_id: teen.id },
    })
    expect(
      await prisma.communityDomainOutbox.count({ where: { stream_id: head.id } })
    ).toBe(0)
    expect(
      await prisma.communityArtifactSubject.count({
        where: { member_id: teen.id, artifact_kind: { in: ['outbox', 'event'] } },
      })
    ).toBe(0)
  })
  it('R14 unavailable rollout defers screening without a failure transition', async () => {
    const { user, post } = await fixture()
    const comment = await prisma.communityComment.create({
      data: {
        post_id: post.id,
        user_id: user.id,
        body: 'held fixture',
        locale: 'en-US',
        platform: 'web',
        status: 'pending_screening',
      },
    })
    await prisma.communityCommentScreeningOutbox.create({
      data: { comment_id: comment.id },
    })
    const processor = new CommunityCommentsProcessor(
      prisma,
      new FixtureCommunityModerationEngine(),
      {
        getFeatureFlag: () =>
          Promise.reject(new ServiceUnavailableException('fixture unavailable')),
      }
    )
    await expect(processor.process(comment.id)).resolves.toBeUndefined()
    await expect(processor.markFailed(comment.id, true)).resolves.toBeUndefined()
    expect(
      await prisma.communityComment.findUnique({ where: { id: comment.id } })
    ).toMatchObject({ status: 'pending_screening' })
    expect(
      await prisma.communityCommentScreeningOutbox.findUnique({
        where: { comment_id: comment.id },
      })
    ).toMatchObject({ generation: 2, dispatched_at: null, attempts: 0 })
  })
  it('R06 draft allocation resuming after account erasure cannot create a new identifying row', async () => {
    const { user } = await fixture()
    const repository = new CommunityRepository(prisma)
    await repository.requestErasureForUser(user.id, new Date())
    await expect(
      repository.createPostDraft(
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'draft' })
        )
      )
    ).rejects.toThrow()
    expect(
      await prisma.lookbookPost.count({ where: { user_id: user.id, status: 'draft' } })
    ).toBe(0)
  })
  it('R06 erasure of a private comment never writes its private status into the public stream', async () => {
    const { user, post } = await fixture()
    await prisma.communityComment.create({
      data: {
        post_id: post.id,
        user_id: user.id,
        body: 'private fixture draft',
        locale: 'en-US',
        platform: 'web',
        status: 'pending_screening',
      },
    })
    await new CommunityRepository(prisma).requestErasureForUser(user.id, new Date())
    expect(
      await prisma.communityDomainOutbox.count({
        where: { stream_id: 'public', kind: 'comment.status' },
      })
    ).toBe(0)
    expect(
      await prisma.communityDomainOutbox.count({
        where: { kind: 'comment.status', post_id: post.id },
      })
    ).toBe(0)
  })

  it('6.5-INT-020 local: normalization completing after erasure cannot restore metadata or its object', async () => {
    const { user, post, bytes } = await fixture()
    const entered = barrier(),
      release = barrier()
    class HeldStorage extends InMemoryCommunityStorage {
      override async upload(path: string, data: Buffer, mime: string) {
        entered.release()
        await release.promise
        return super.upload(path, data, mime)
      }
    }
    const storage = new HeldStorage()
    storage.put(post.image_object_path!, bytes)
    const processor = new CommunityModerationProcessor(
      prisma,
      storage,
      telemetry,
      new FixtureCommunityModerationEngine({
        textOutcome: { passed: true, reasons: [] },
        imageOutcome: { passed: true, reasons: [] },
      }),
      undefined,
      { getFeatureFlag: () => Promise.resolve(true) }
    )
    const processing = processor.process({ postId: post.id, uploadSessionId: post.id })
    const settled = Promise.allSettled([processing])
    try {
      await entered.promise
      await new CommunityRepository(prisma).requestErasureForUser(user.id, new Date())
      await new CommunityMaintenanceService(prisma, storage).sweepErasureRequests()
      release.release()
      expect((await settled)[0]).toMatchObject({ status: 'rejected' })
      expect(
        await prisma.lookbookPost.findUnique({ where: { id: post.id } })
      ).toMatchObject({
        status: 'withdrawn',
        image_checksum: null,
        image_object_path: null,
      })
      expect(storage.objects.has(post.image_object_path!)).toBe(false)
      expect(await prisma.moderationEvent.count({ where: { post_id: post.id } })).toBe(0)
    } finally {
      release.release()
      await settled
    }
  })
  it('6.5-INT-021 local: a delayed screening refusal cannot append erased content into audit', async () => {
    const { user, post, bytes } = await fixture()
    const entered = barrier(),
      release = barrier()
    const storage = new InMemoryCommunityStorage()
    storage.put(post.image_object_path!, bytes)
    class HeldEngine extends FixtureCommunityModerationEngine {
      override async moderatePost(
        input: Parameters<FixtureCommunityModerationEngine['moderatePost']>[0]
      ) {
        entered.release()
        await release.promise
        return super.moderatePost(input)
      }
    }
    const processor = new CommunityModerationProcessor(
      prisma,
      storage,
      telemetry,
      new HeldEngine(),
      undefined,
      { getFeatureFlag: () => Promise.resolve(true) }
    )
    const processing = processor.process({ postId: post.id, uploadSessionId: post.id })
    const settled = Promise.allSettled([processing])
    try {
      await entered.promise
      await new CommunityRepository(prisma).requestErasureForUser(user.id, new Date())
      await new CommunityMaintenanceService(prisma, storage).sweepErasureRequests()
      release.release()
      expect((await settled)[0]).toMatchObject({ status: 'fulfilled' })
      expect(
        await prisma.lookbookPost.findUnique({ where: { id: post.id } })
      ).toMatchObject({ status: 'withdrawn', caption: null })
      expect(await prisma.moderationEvent.count({ where: { post_id: post.id } })).toBe(0)
    } finally {
      release.release()
      await settled
    }
  })
})
