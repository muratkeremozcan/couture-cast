// Learning path Step 62: Community post edits persist.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-62-community-post-edits-persist
import 'reflect-metadata'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_POST_TEXT_CONFLICT_MESSAGE,
  COMMUNITY_POST_TEXT_REJECTED_MESSAGE,
  COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
  editCommunityPostTextResponseSchema,
} from '@couture/api-client/contracts/http'
import { ServiceUnavailableException } from '@nestjs/common'
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
import { seedDecision } from './helpers/moderation-history-seed.js'

useGuardianConsentPolicy('required_13_15')
const { prisma, repository, fixture } = reactionTestContext()
afterEach(() => vi.unstubAllEnvs())

async function buildHttpHarness() {
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
  const api = request(await listenHttpApp(app))
  return { app, api, guardianService }
}

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

  const { app, api, guardianService } = await buildHttpHarness()
  try {
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

it('persists title-only, caption-only, and combined edits over HTTP and keeps revision on unchanged payload', async () => {
  vi.stubEnv('TEST_ENV', 'local')
  const member = await fixture()
  const { app, api } = await buildHttpHarness()
  try {
    const path = `/api/v1/community/posts/${member.postId}/text`
    const patchAsMember = (body: {
      baseRevision: number
      title: string | null
      caption: string | null
    }) =>
      api
        .patch(path)
        .set('Authorization', `Bearer test-token:guardian:${member.userId}`)
        .send(body)

    const initial = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: member.postId },
      select: { caption: true },
    })

    const titleOnly = await patchAsMember({
      baseRevision: 0,
      title: 'Plum satin layers',
      caption: initial.caption,
    }).expect(200)
    expect(
      editCommunityPostTextResponseSchema.parse(titleOnly.body as unknown).data
    ).toEqual({
      title: 'Plum satin layers',
      caption: initial.caption,
      textRevision: 1,
    })

    const captionOnly = await patchAsMember({
      baseRevision: 1,
      title: 'Plum satin layers',
      caption: 'Warm wrap dress for cool evenings',
    }).expect(200)
    expect(
      editCommunityPostTextResponseSchema.parse(captionOnly.body as unknown).data
    ).toEqual({
      title: 'Plum satin layers',
      caption: 'Warm wrap dress for cool evenings',
      textRevision: 2,
    })

    const unchanged = await patchAsMember({
      baseRevision: 2,
      title: '  Plum satin layers  ',
      caption: '  Warm wrap dress for cool evenings  ',
    }).expect(200)
    expect(
      editCommunityPostTextResponseSchema.parse(unchanged.body as unknown).data
    ).toEqual({
      title: 'Plum satin layers',
      caption: 'Warm wrap dress for cool evenings',
      textRevision: 2,
    })

    const combined = await patchAsMember({
      baseRevision: 2,
      title: 'Autumn plum look',
      caption: 'Wrap dress with cropped jacket',
    }).expect(200)
    expect(
      editCommunityPostTextResponseSchema.parse(combined.body as unknown).data
    ).toEqual({
      title: 'Autumn plum look',
      caption: 'Wrap dress with cropped jacket',
      textRevision: 3,
    })

    const rejected = await patchAsMember({
      baseRevision: 3,
      title: 'merde what a night',
      caption: 'Wrap dress with cropped jacket',
    }).expect(400)
    expect(rejected.body).toMatchObject({ message: COMMUNITY_POST_TEXT_REJECTED_MESSAGE })

    const events = await prisma.moderationEvent.findMany({
      where: { post_id: member.postId },
      select: { action: true },
    })
    expect(events.filter((row) => row.action === 'post_text_approved')).toHaveLength(3)
    expect(events.filter((row) => row.action === 'post_text_withheld')).toHaveLength(1)
  } finally {
    await app.close()
  }
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

it('rechecks guardian consent inside the lock when consent is revoked during pre-transaction screening', async () => {
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

  const screeningStarted = deferred<void>()
  const releaseScreening = deferred<{
    passed: boolean
    policyVersion: string
  }>()

  const editPromise = repository.editPublishedPostText({
    userId: teen.userId,
    postId: teen.postId,
    baseRevision: 0,
    title: 'Screen-raced title',
    caption: 'Screen-raced caption',
    screen: () => {
      screeningStarted.resolve()
      return releaseScreening.promise
    },
  })

  await screeningStarted.promise
  // Revocation acquires `community_member:<userId>`. Succeeding while screening is
  // suspended proves screening does not hold the privacy/member lock.
  await expect(
    guardianService.revokeConsent(guardian.userId, teen.userId)
  ).resolves.toMatchObject({
    remainingActiveGuardians: 0,
  })
  releaseScreening.resolve({ passed: true, policyVersion: 'fixture-v1' })

  await expect(editPromise).rejects.toMatchObject({
    status: 403,
  })

  const stored = await prisma.lookbookPost.findUniqueOrThrow({
    where: { id: teen.postId },
    select: { title: true, text_revision: true, status: true },
  })
  expect(stored).toEqual({ title: null, text_revision: 0, status: 'consent_suspended' })
})

it('rechecks active sanctions inside the lock when a member is banned during pre-transaction screening', async () => {
  const member = await fixture()
  const screeningStarted = deferred<void>()
  const releaseScreening = deferred<{
    passed: boolean
    policyVersion: string
  }>()

  const editPromise = repository.editPublishedPostText({
    userId: member.userId,
    postId: member.postId,
    baseRevision: 0,
    title: 'Sanction-raced title',
    caption: null,
    screen: () => {
      screeningStarted.resolve()
      return releaseScreening.promise
    },
  })

  await screeningStarted.promise
  const at = new Date()
  const caseKey = `post.${member.postId}`
  const decision = await seedDecision(prisma, {
    caseKey,
    at,
    action: 'ban',
  })
  const sanction = await prisma.communitySanction.create({
    data: {
      user_id: member.userId,
      decision_id: decision.id,
      case_key: caseKey,
      kind: 'permanent',
      created_at: at,
    },
  })
  try {
    releaseScreening.resolve({ passed: true, policyVersion: 'fixture-v1' })

    await expect(editPromise).rejects.toMatchObject({
      status: 403,
      response: { code: 'community_banned' },
    })
    const stored = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: member.postId },
      select: { title: true, text_revision: true },
    })
    expect(stored).toEqual({ title: null, text_revision: 0 })
  } finally {
    await prisma.communitySanction.deleteMany({ where: { id: sanction.id } })
  }
})

it('rejects a stale edit with 409 when a competing edit commits while screening is in flight', async () => {
  const member = await fixture()
  const screeningStarted = deferred<void>()
  const releaseScreening = deferred<{
    passed: boolean
    policyVersion: string
  }>()

  const slowEdit = repository.editPublishedPostText({
    userId: member.userId,
    postId: member.postId,
    baseRevision: 0,
    title: 'Slow edit title',
    caption: 'Slow edit caption',
    screen: () => {
      screeningStarted.resolve()
      return releaseScreening.promise
    },
  })

  await screeningStarted.promise
  // Competing edit acquires `LookbookPost FOR UPDATE` while slowEdit is still screening.
  await expect(
    repository.editPublishedPostText({
      userId: member.userId,
      postId: member.postId,
      baseRevision: 0,
      title: 'Fast winning title',
      caption: 'Fast winning caption',
      screen: () => Promise.resolve({ passed: true, policyVersion: 'fixture-v1' }),
    })
  ).resolves.toEqual({
    title: 'Fast winning title',
    caption: 'Fast winning caption',
    textRevision: 1,
  })

  releaseScreening.resolve({ passed: true, policyVersion: 'fixture-v1' })
  await expect(slowEdit).rejects.toMatchObject({
    status: 409,
    message: COMMUNITY_POST_TEXT_CONFLICT_MESSAGE,
  })

  const stored = await prisma.lookbookPost.findUniqueOrThrow({
    where: { id: member.postId },
    select: { title: true, caption: true, text_revision: true },
  })
  expect(stored).toEqual({
    title: 'Fast winning title',
    caption: 'Fast winning caption',
    text_revision: 1,
  })
})

it('refuses commits when screening is unavailable or unbound to the normalized text', async () => {
  const member = await fixture()

  await expect(
    repository.editPublishedPostText({
      userId: member.userId,
      postId: member.postId,
      baseRevision: 0,
      title: 'Outage title',
      caption: null,
      screen: () =>
        Promise.reject(
          new ServiceUnavailableException(
            COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE
          )
        ),
    })
  ).rejects.toMatchObject({
    status: 503,
    message: COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
  })

  await expect(
    repository.editPublishedPostText({
      userId: member.userId,
      postId: member.postId,
      baseRevision: 0,
      title: 'Mismatched fingerprint title',
      caption: null,
      screen: () =>
        Promise.resolve({
          passed: true,
          policyVersion: 'fixture-v1',
          textFingerprint: 'wrong-fingerprint',
        }),
    })
  ).rejects.toMatchObject({
    status: 503,
    message: COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
  })

  const stored = await prisma.lookbookPost.findUniqueOrThrow({
    where: { id: member.postId },
    select: { title: true, text_revision: true },
  })
  expect(stored).toEqual({ title: null, text_revision: 0 })
})
