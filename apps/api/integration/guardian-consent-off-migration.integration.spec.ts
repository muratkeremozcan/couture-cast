// MIG-PENDING-ACTIVE (owner ruling 2026-11-16): the guardian-consent-off migration makes every
// teen still waiting on a guardian active, revoked consent included, and changes nothing else.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { birthdateForAge } from '../src/testing/birthdate.js'

const migration = readFileSync(
  resolve(
    __dirname,
    '../../../packages/db/prisma/migrations/20261116120000_guardian_consent_off/migration.sql'
  ),
  'utf8'
)
const database = isolatedCommunityDatabase()
let prisma: PrismaClient

/** The migration's own timestamp, in the ISO shape the app writes. */
const WAIVED_AT: unknown = expect.stringMatching(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
)

const email = (label: string) => `mig-${label}-${randomUUID()}@synthetic.test`

async function profileRow(
  label: string,
  age: number,
  preferences: Prisma.InputJsonValue | typeof Prisma.DbNull
) {
  const user = await prisma.user.create({
    data: {
      email: email(label),
      profile: { create: { birthdate: birthdateForAge(age), preferences } },
    },
  })
  return user.id
}

const preferencesOf = async (userId: string) =>
  (await prisma.userProfile.findUniqueOrThrow({ where: { user_id: userId } })).preferences

beforeAll(async () => {
  await database.migrate()
  prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
}, 60_000)

afterAll(async () => {
  await prisma?.$disconnect()
  await database.drop()
})

describe('MIG-PENDING-ACTIVE: 20261116120000_guardian_consent_off', () => {
  it('activates waiting and revoked teens, keeps consent rows, and touches nothing else', async () => {
    const pending = await profileRow('pending', 14, {
      compliance: {
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      },
      theme: 'dark',
    })
    const revokedAt = '2026-11-01T10:00:00.000Z'
    const revoked = await profileRow('revoked', 15, {
      compliance: {
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
        guardianConsentGrantedAt: null,
        guardianConsentRevokedAt: revokedAt,
      },
    })
    const guardian = await prisma.user.create({ data: { email: email('guardian') } })
    const consent = await prisma.guardianConsent.create({
      data: {
        guardian_id: guardian.id,
        teen_id: revoked,
        consent_level: 'full_access',
        status: 'revoked',
        revoked_at: new Date(revokedAt),
      },
    })
    const untouched = {
      adult: await profileRow('adult', 30, {
        compliance: { accountStatus: 'active', guardianConsentRequired: false },
      }),
      approvedTeen: await profileRow('approved', 14, {
        compliance: { accountStatus: 'active', guardianConsentRequired: false },
      }),
      suspended: await profileRow('suspended', 14, {
        compliance: { accountStatus: 'suspended' },
      }),
      blockedUnderage: await profileRow('underage', 12, {
        compliance: { accountStatus: 'blocked_underage' },
      }),
      noCompliance: await profileRow('plain', 30, { theme: 'light' }),
      stringCompliance: await profileRow('odd', 30, {
        compliance: 'pending_guardian_consent',
      }),
      nullPreferences: await profileRow('null', 30, Prisma.DbNull),
    }
    const before = new Map<string, Prisma.JsonValue>()
    for (const [key, id] of Object.entries(untouched))
      before.set(key, await preferencesOf(id))

    const changed = await prisma.$executeRawUnsafe(migration)
    expect(changed).toBe(2)

    const waived = (await preferencesOf(pending)) as {
      compliance: Record<string, unknown>
      theme: string
    }
    expect(waived).toEqual({
      compliance: {
        accountStatus: 'active',
        guardianConsentRequired: false,
        guardianConsentWaivedAt: WAIVED_AT,
      },
      theme: 'dark',
    })
    expect(await preferencesOf(revoked)).toEqual({
      compliance: {
        accountStatus: 'active',
        guardianConsentRequired: false,
        guardianConsentGrantedAt: null,
        guardianConsentRevokedAt: revokedAt,
        guardianConsentWaivedAt: WAIVED_AT,
      },
    })
    expect(
      await prisma.guardianConsent.findUniqueOrThrow({ where: { id: consent.id } })
    ).toEqual(consent)
    for (const [key, id] of Object.entries(untouched))
      expect(await preferencesOf(id), key).toEqual(before.get(key))

    expect(await prisma.$executeRawUnsafe(migration)).toBe(0)
  })
})
