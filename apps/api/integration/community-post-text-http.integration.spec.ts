import 'reflect-metadata'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  editCommunityPostTextResponseSchema,
} from '@couture/api-client/contracts/http'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, expect, it, vi } from 'vitest'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommunitySponsorshipService } from '../src/modules/commerce/community-sponsorship.service.js'
import { CommunityController } from '../src/modules/community/community.controller.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { CommunitySpotlightService } from '../src/modules/community/community-spotlight.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import { birthdateForAge } from '../src/testing/birthdate.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import { reactionTestContext } from './helpers/community-reaction-context.js'
import { noSponsorships } from './helpers/community-sponsorship-fixtures.js'
import { useGuardianConsentPolicy } from './helpers/guardian-consent-policy.js'

useGuardianConsentPolicy('required_13_15')
const { prisma, repository, fixture } = reactionTestContext()
afterEach(() => vi.unstubAllEnvs())

it('refuses a teen post text edit over HTTP after the last guardian revokes consent', async () => {
  vi.stubEnv('TEST_ENV', 'local')
  const guardian = await fixture()
  const teen = await fixture(birthdateForAge(15).toISOString())
  await prisma.guardianConsent.create({
    data: {
      guardian_id: guardian.userId,
      teen_id: teen.userId,
      status: 'granted',
      consent_level: 'full_access',
    },
  })

  const consent = new GuardianConsentStateService(prisma)
  const guardianService = new GuardianService({ capture: vi.fn() }, prisma, consent, {
    invalidateUserSessions: vi.fn().mockResolvedValue(undefined),
  } as never)
  const community = new CommunityService(
    repository,
    { getFeatureFlag: vi.fn().mockResolvedValue(true) } as never,
    {} as never,
    {} as never,
    new InMemoryCommunityStorage(),
    guardianService
  )
  const module = await Test.createTestingModule({
    controllers: [CommunityController],
    providers: [
      { provide: CommunityService, useValue: community },
      { provide: CommunitySpotlightService, useValue: {} },
      { provide: CommunitySponsorshipService, useValue: noSponsorships },
      { provide: GuardianConsentStateService, useValue: consent },
      {
        provide: AccessTokenIdentityService,
        useValue: new AccessTokenIdentityService(prisma),
      },
    ],
  }).compile()
  const app = module.createNestApplication()
  app.useLogger(false)
  try {
    const api = request(await listenHttpApp(app))
    const path = `/api/v1/community/posts/${teen.postId}/text`
    const editAsTeen = () =>
      api.patch(path).set('Authorization', `Bearer test-token:teen:${teen.userId}`)
    const approved = {
      title: 'Plum evening layers',
      caption: 'A wrap dress and light jacket',
    }

    await api
      .patch(path)
      .send({ baseRevision: 0, ...approved })
      .expect(401)
    const before = await editAsTeen()
      .send({ baseRevision: 0, ...approved })
      .expect(200)
    expect(
      editCommunityPostTextResponseSchema.parse(before.body as unknown).data
    ).toEqual({
      ...approved,
      textRevision: 1,
    })

    await expect(
      guardianService.revokeConsent(guardian.userId, teen.userId)
    ).resolves.toMatchObject({
      remainingActiveGuardians: 0,
    })
    const rejected = await editAsTeen()
      .send({ baseRevision: 1, title: 'Autumn outfit', caption: 'A wool coat and scarf' })
      .expect(403)
    expect(rejected.body).toMatchObject({ message: COMMUNITY_AGE_GATE_DENIED_MESSAGE })

    const stored = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: teen.postId },
      select: { title: true, caption: true, text_revision: true, status: true },
    })
    expect(stored).toEqual({ ...approved, text_revision: 1, status: 'consent_suspended' })
  } finally {
    await app.close()
  }
})
