import { communityReactionResponseSchema } from '@couture/api-client/contracts/http'
import { Test } from '@nestjs/testing'
import 'reflect-metadata'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommunityController } from '../src/modules/community/community.controller.js'
import { CommunityService } from '../src/modules/community/community.service.js'

import { reactionTestContext } from './helpers/community-reaction-context.js'

const { prisma, repository, guardian, input, fixture, mutate } = reactionTestContext()

describe('Story 6.3 guarded reaction HTTP routes', () => {
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
})
