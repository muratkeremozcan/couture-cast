// A-OFF-GUARDIAN-ACCESS (TEA sign-off F-3, 2026-11-16): while guardian consent is off, a
// granted GuardianConsent row stays for audit and grants nothing. Nobody can revoke it (the
// revoke route answers 409), and teen-path finding B-1 showed a teen could grant one to any
// adult. Under required_13_15 the same row keeps the guardian's access and mail.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { NotFoundException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { RequestAuthContext } from '../src/modules/auth/security.types.js'
import type { GuardianService } from '../src/modules/guardian/guardian.service.js'
import { SilhouettePhotoProcessor } from '../src/modules/wardrobe/silhouette-photo.processor.js'
import type { SilhouettePhotoModerationEngine } from '../src/modules/wardrobe/silhouette-photo-moderation.engine.js'
import { WardrobeAccessService } from '../src/modules/wardrobe/wardrobe-access.service.js'
import { WardrobeCapsuleRepository } from '../src/modules/wardrobe/wardrobe-capsule.repository.js'
import { WardrobeCapsuleService } from '../src/modules/wardrobe/wardrobe-capsule.service.js'
import type { WardrobeStorage } from '../src/modules/wardrobe/wardrobe-storage.adapter.js'
import { birthdateForAge } from '../src/testing/birthdate.js'
import { useGuardianConsentPolicy } from './helpers/guardian-consent-policy.js'
import { deleteGuardianConsents, deleteMembers } from './helpers/privacy-guards.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const namespace = `gc-off-access-${randomUUID().slice(0, 8)}`
const FLAG_CHANNEL = 'email.guardian-silhouette-flag'

/** The upload gate passes: these cases are about the guardian branch alone. */
const guardianService = {
  assertWardrobeUploadAllowed: () => Promise.resolve(),
} as unknown as GuardianService
const access = new WardrobeAccessService(prisma, guardianService)
const capsules = new WardrobeCapsuleService(
  new WardrobeCapsuleRepository(prisma),
  access,
  {} as never,
  {} as never,
  {} as never,
  {} as never
)
const processor = new SilhouettePhotoProcessor(
  prisma,
  { download: () => Promise.resolve(Buffer.from('photo')) } as unknown as WardrobeStorage,
  {
    moderate: () => Promise.resolve({ outcome: 'privacy_violation' }),
  } as unknown as SilhouettePhotoModerationEngine
)

let teenId: string
let guardian: RequestAuthContext
let guardianEmail: string

async function seedGrantedGuardian() {
  const teen = await prisma.user.create({
    data: {
      email: `${namespace}-teen-${randomUUID()}@synthetic.test`,
      profile: {
        create: {
          birthdate: birthdateForAge(14),
          preferences: {
            compliance: { accountStatus: 'active', guardianConsentRequired: false },
          },
        },
      },
    },
  })
  guardianEmail = `${namespace}-guardian-${randomUUID()}@synthetic.test`
  const adult = await prisma.user.create({ data: { email: guardianEmail } })
  await prisma.guardianConsent.create({
    data: {
      guardian_id: adult.id,
      teen_id: teen.id,
      consent_level: 'full_access',
      status: 'granted',
    },
  })
  teenId = teen.id
  guardian = { token: 't', userId: adult.id, role: 'guardian' }
}

async function flaggedPhoto() {
  const profile = await prisma.silhouetteProfile.create({
    data: {
      user_id: teenId,
      my_form_object_path: `wardrobe/${teenId}/silhouette/${randomUUID()}.png`,
      my_form_status: 'processing',
    },
  })
  await processor.process(profile.id)
  return {
    profile: await prisma.silhouetteProfile.findUniqueOrThrow({
      where: { id: profile.id },
    }),
    moderationEvents: await prisma.moderationEvent.count({
      where: { silhouette_profile_id: profile.id },
    }),
    mails: await prisma.eventEnvelope.findMany({
      where: { user_id: teenId, channel: FLAG_CHANNEL },
    }),
  }
}

beforeEach(seedGrantedGuardian)

afterAll(async () => {
  const members = { email: { contains: namespace } }
  await prisma.eventEnvelope.deleteMany({ where: { user: members } })
  await prisma.moderationEvent.deleteMany({
    where: { silhouette_profile: { user: members } },
  })
  await deleteGuardianConsents(prisma, { teen: members })
  await prisma.userProfile.deleteMany({ where: { user: members } })
  await deleteMembers(prisma, members)
  await prisma.$disconnect()
})

describe('A-OFF-GUARDIAN-ACCESS under policy off', () => {
  useGuardianConsentPolicy('off')

  it('a granted guardian gets 404 NOT_FOUND on the teen capsules, read and write', async () => {
    const read = capsules.listCapsules(guardian, teenId, { limit: 20, offset: 0 })
    await expect(read).rejects.toThrow(NotFoundException)
    await expect(read).rejects.toThrow('NOT_FOUND')
    const write = capsules.updateCapsule(guardian, teenId, randomUUID(), '"1"', {})
    await expect(write).rejects.toThrow(NotFoundException)
    await expect(write).rejects.toThrow('NOT_FOUND')
  })

  it('a flagged teen photo fails with no moderation event and no guardian mail', async () => {
    const { profile, moderationEvents, mails } = await flaggedPhoto()
    expect(profile.my_form_status).toBe('failed')
    expect(profile.my_form_failure_reason).toBe('privacy_violation')
    expect(moderationEvents).toBe(0)
    expect(mails).toEqual([])
  })

  it('keeps the consent row for audit', async () => {
    expect(
      await prisma.guardianConsent.findMany({
        where: { teen_id: teenId },
        select: { guardian_id: true, status: true, revoked_at: true },
      })
    ).toEqual([{ guardian_id: guardian.userId, status: 'granted', revoked_at: null }])
  })
})

describe('A-OFF-GUARDIAN-ACCESS under policy required_13_15', () => {
  useGuardianConsentPolicy('required_13_15')

  it('the granted guardian keeps read and write on the teen capsules', async () => {
    await expect(
      capsules.listCapsules(guardian, teenId, { limit: 20, offset: 0 })
    ).resolves.toEqual({
      data: [],
      total: 0,
      limit: 20,
      offset: 0,
    })
    await expect(access.assertWriteAccess(guardian, teenId)).resolves.toEqual({
      actorRole: 'guardian',
    })
  })

  it('a flagged teen photo mails the granted guardian once', async () => {
    const { profile, moderationEvents, mails } = await flaggedPhoto()
    expect(profile.my_form_status).toBe('failed')
    expect(moderationEvents).toBe(1)
    expect(mails.map((mail) => (mail.payload as { to: string }).to)).toEqual([
      guardianEmail,
    ])
  })
})
