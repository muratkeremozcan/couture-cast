// Learning path Step 54: Complimentary full access.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
// Story 6.14 TEA, slice 8: account erasure against complimentary grants, and the grant
// lifecycle as ordered pairs of events across the member, the granting admin and a second
// admin. Everything runs through the real operator service and the real erasure
// transaction on a UUID-named database this file owns.
//
// Races are forced, never slept: the test holds the member's (or actor's) exclusive
// privacy guard, `pg_advisory_xact_lock(65001, hashtext(id))`. It is the first lock the
// operator and the erasure both block on for that id: the operator takes it in
// `guardCommunitySubject` (community_prepare_subject_privacy), and the erasure takes it in
// the same call after its sanction lock, which the operator never takes. The
// `community_member:` lock comes later in both, so holding it would not order them.
// Waiters are counted in pg_stat_activity, and Postgres grants queued advisory locks in
// arrival order, so the order the test starts the two operations is the order they run.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildPremiumEntitlementCreateInput,
  createPremiumEntitlement,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { seedAdmin } from './helpers/community-sponsorship-fixtures.js'
import { erase, scanForIdentity } from './helpers/moderation-history-seed.js'
import {
  COMPLIMENTARY_ACCESS_GRANTED_EVENT,
  COMPLIMENTARY_ACCESS_REVOKED_EVENT,
  ComplimentaryAccessOperatorService,
  ComplimentaryAccessRefusal,
  ERASED_OPERATOR_LABEL,
  type ComplimentaryAccessRefusalCode,
} from '../src/modules/commerce/complimentary-access-operator.service.js'
import { PremiumEntitlementService } from '../src/modules/commerce/premium-entitlement.service.js'
import { FakeRevenueCatClient } from '../src/modules/commerce/revenuecat-client.js'
import { FakeStripeBillingClient } from '../src/modules/commerce/stripe-client.js'
import { ComplimentaryAccessService } from '../src/modules/feature-flags/complimentary-access.service.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
// PostHog defines no kill switch, so the FeatureFlag row or the code default (true) decides.
const remote = { getFeatureFlagValue: () => Promise.resolve(undefined) }
const operator = new ComplimentaryAccessOperatorService(prisma)
const access = new ComplimentaryAccessService(prisma, remote)
const premium = new PremiumEntitlementService(
  prisma,
  new FakeRevenueCatClient(),
  new FakeStripeBillingClient(),
  access
)
const EVENTS = [COMPLIMENTARY_ACCESS_GRANTED_EVENT, COMPLIMENTARY_ACCESS_REVOKED_EVENT]

beforeAll(async () => {
  await database.migrate()
}, 120_000)
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

type Party = { id: string; email: string }

async function newMember(label: string): Promise<Party> {
  const email = `cc614-${label}-${randomUUID()}@erasure.test`
  const user = await prisma.user.create({ data: { email } })
  return { id: user.id, email }
}

async function newAdmin(label: string): Promise<Party> {
  const { email, userId } = await seedAdmin(prisma, `cc614-${label}`)
  return { id: userId, email }
}

const change = (actor: Party, target: Party, reason = 'family tester') => ({
  actorEmail: actor.email,
  memberEmail: target.email,
  reason,
  dryRun: false,
})

async function grantBy(actor: Party, target: Party): Promise<string> {
  const outcome = await operator.grant(change(actor, target))
  expect(outcome.grantId).toEqual(expect.any(String))
  return outcome.grantId!
}

const revokeBy = (actor: Party, target: Party) =>
  operator.revoke(change(actor, target, 'test over'))

async function refused(
  work: Promise<unknown>,
  code: ComplimentaryAccessRefusalCode
): Promise<void> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown
  )
  expect(error).toBeInstanceOf(ComplimentaryAccessRefusal)
  expect((error as ComplimentaryAccessRefusal).code).toBe(code)
}

const grantRows = (memberId: string) =>
  prisma.complimentaryAccessGrant.findMany({
    where: { member_id: memberId },
    orderBy: { granted_at: 'asc' },
  })

const auditRows = (actorId: string) =>
  prisma.auditLog.findMany({
    where: { user_id: actorId, event_type: { in: EVENTS } },
    orderBy: { timestamp: 'asc' },
    select: { user_id: true, event_type: true, event_data: true },
  })

const erasureRequest = (memberId: string) =>
  prisma.moderationErasureRequest.findUnique({ where: { member_id: memberId } })

/** A cached community read row for the member, so a grant or revoke has one to delete. */
async function primeCache(memberId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "CommunityFlagEvaluation" (member_id, flag_key, subject_generation)
      SELECT member_id, 'community_read_enabled', generation FROM "CommunitySubject" WHERE member_id = ${memberId}
      ON CONFLICT DO NOTHING`
  expect(await cacheRows(memberId)).toBe(1)
}

const cacheRows = (memberId: string) =>
  prisma.communityFlagEvaluation.count({ where: { member_id: memberId } })

async function killSwitch(open: boolean): Promise<void> {
  if (open) {
    await prisma.featureFlag.deleteMany({
      where: { key: 'complimentary_access_enabled' },
    })
    return
  }
  await prisma.featureFlag.upsert({
    where: { key: 'complimentary_access_enabled' },
    create: { key: 'complimentary_access_enabled', value: false },
    update: { value: false },
  })
}

/** Holds one id's exclusive privacy guard in its own session until released. */
async function holdGuard(id: string): Promise<{ release: () => Promise<void> }> {
  const holder = new Client({ connectionString: database.url })
  await holder.connect()
  await holder.query('BEGIN')
  await holder.query('SELECT pg_advisory_xact_lock(65001, hashtext($1))', [id])
  return {
    release: async () => {
      await holder.query('COMMIT')
      await holder.end()
    },
  }
}

/** Polls until exactly `count` sessions wait on an advisory lock. 10 ms ticks, 5 s cap. */
async function untilWaiting(count: number): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'`
    if (row!.n === count) return
    if (Date.now() > deadline)
      throw new Error(`expected ${count} advisory waiters, saw ${row!.n}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Settles a promise into a value, so a race's loser can be inspected after both finish. */
const settle = <T>(work: Promise<T>) =>
  work.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  )

async function paid(userId: string, status: 'active' | 'expired'): Promise<void> {
  const at = new Date('2026-11-01T00:00:00.000Z')
  await prisma.premiumEntitlement.upsert({
    where: { user_id: userId },
    create: buildPremiumEntitlementCreateInput(
      createPremiumEntitlement({
        userId,
        status,
        store: 'app_store',
        productId: 'premium_monthly',
        willRenew: status === 'active',
        currentPeriodEnd: new Date('2030-01-01T00:00:00.000Z'),
        syncedAt: at,
        lastEventOccurredAt: at,
        lastEventId: `cc614-${randomUUID()}`,
      })
    ),
    update: { status, will_renew: status === 'active' },
  })
}

describe('account erasure and complimentary grants', () => {
  it('I-ERASE-DELETES: erasure removes every grant row for the member and leaves audit rows holding actor and grant id only', async () => {
    const admin = await newAdmin('deletes')
    const target = await newMember('deletes')
    const first = await grantBy(admin, target)
    await revokeBy(admin, target)
    const second = await grantBy(admin, target)
    expect((await grantRows(target.id)).map((row) => row.id)).toEqual([first, second])

    await erase(prisma, target.id, new Date())

    expect(await grantRows(target.id)).toEqual([])
    expect(await access.isActive(target.id)).toBe(false)
    expect(await auditRows(admin.id)).toEqual([
      {
        user_id: admin.id,
        event_type: COMPLIMENTARY_ACCESS_GRANTED_EVENT,
        event_data: { grantId: first },
      },
      {
        user_id: admin.id,
        event_type: COMPLIMENTARY_ACCESS_REVOKED_EVENT,
        event_data: { grantId: first },
      },
      {
        user_id: admin.id,
        event_type: COMPLIMENTARY_ACCESS_GRANTED_EVENT,
        event_data: { grantId: second },
      },
    ])
    const hits = await scanForIdentity(prisma, [target.id, target.email])
    expect(
      hits.filter(
        (hit) =>
          hit.startsWith('ComplimentaryAccessGrant.') || hit.startsWith('AuditLog.')
      )
    ).toEqual([])
  })

  it('I-ERASE-GRANTER: an erased admin leaves no id on other members grants, and those grants keep working', async () => {
    const a = await newAdmin('granter-a')
    const b = await newAdmin('granter-b')
    const target = await newMember('granter')
    const older = await grantBy(a, target)
    await revokeBy(a, target)
    const active = await grantBy(a, target)

    await erase(prisma, a.id, new Date())

    const rows = await grantRows(target.id)
    expect(
      rows.map((row) => ({
        id: row.id,
        granted_by_id: row.granted_by_id,
        revoked_by_id: row.revoked_by_id,
      }))
    ).toEqual([
      { id: older, granted_by_id: null, revoked_by_id: null },
      { id: active, granted_by_id: null, revoked_by_id: null },
    ])
    expect(rows[0]!.revoked_at).toBeInstanceOf(Date)
    expect(rows[0]!.revoke_reason).toBe('test over')
    expect(await access.isActive(target.id)).toBe(true)
    const listing = await operator.list(b.email)
    expect(listing.grants.filter((row) => row.grantId === active)).toEqual([
      expect.objectContaining({
        memberEmail: target.email,
        granterEmail: ERASED_OPERATOR_LABEL,
      }),
    ])
    expect(ERASED_OPERATOR_LABEL).toBe('[erased]')
  })

  it('I-ERASE-REFUSE-GRANT: a member with an erasure request cannot be granted', async () => {
    const admin = await newAdmin('refuse')
    const target = await newMember('refuse')
    await erase(prisma, target.id, new Date())

    await refused(operator.grant(change(admin, target)), 'member_erasure_requested')
    expect(await grantRows(target.id)).toEqual([])
    expect(await auditRows(admin.id)).toEqual([])
  })

  it('I-CLI-ACTOR-ERASURE: an admin with an erasure request can neither grant nor revoke', async () => {
    const a = await newAdmin('actor-erasure')
    const b = await newAdmin('actor-erasure-b')
    const fresh = await newMember('actor-erasure-fresh')
    const granted = await newMember('actor-erasure-granted')
    const existing = await grantBy(b, granted)
    await erase(prisma, a.id, new Date())

    await refused(operator.grant(change(a, fresh)), 'actor_erasure_requested')
    await refused(revokeBy(a, granted), 'actor_erasure_requested')
    expect(await grantRows(fresh.id)).toEqual([])
    const [row] = await grantRows(granted.id)
    expect({ id: row!.id, revoked_at: row!.revoked_at }).toEqual({
      id: existing,
      revoked_at: null,
    })
    expect(await auditRows(a.id)).toEqual([])
  })

  it('I-ERASE-RACE-GRANT, grant then erasure: the grant commits and the erasure that queued behind it deletes it', async () => {
    const admin = await newAdmin('race-grant-1')
    const target = await newMember('race-grant-1')
    const held = await holdGuard(target.id)
    let granting: ReturnType<typeof settle<Awaited<ReturnType<typeof operator.grant>>>>
    let erasing: ReturnType<typeof settle<unknown>>
    try {
      granting = settle(operator.grant(change(admin, target)))
      await untilWaiting(1)
      erasing = settle(erase(prisma, target.id, new Date()))
      await untilWaiting(2)
    } finally {
      await held.release()
    }
    const granted = await granting
    const erased = await erasing

    expect(granted.ok).toBe(true)
    expect(erased.ok).toBe(true)
    expect(await grantRows(target.id)).toEqual([])
    expect(await erasureRequest(target.id)).not.toBeNull()
    expect(await auditRows(admin.id)).toEqual([
      {
        user_id: admin.id,
        event_type: COMPLIMENTARY_ACCESS_GRANTED_EVENT,
        event_data: { grantId: granted.ok ? granted.value.grantId : null },
      },
    ])
  })

  it('I-ERASE-RACE-GRANT, erasure then grant: the queued grant sees the request and refuses', async () => {
    const admin = await newAdmin('race-grant-2')
    const target = await newMember('race-grant-2')
    const held = await holdGuard(target.id)
    let erasing: ReturnType<typeof settle<unknown>>
    let granting: ReturnType<typeof settle<unknown>>
    try {
      erasing = settle(erase(prisma, target.id, new Date()))
      await untilWaiting(1)
      granting = settle(operator.grant(change(admin, target)))
      await untilWaiting(2)
    } finally {
      await held.release()
    }
    const erased = await erasing
    const granted = await granting

    expect(erased.ok).toBe(true)
    expect(granted.ok).toBe(false)
    if (!granted.ok) {
      expect(granted.error).toBeInstanceOf(ComplimentaryAccessRefusal)
      expect((granted.error as ComplimentaryAccessRefusal).code).toBe(
        'member_erasure_requested'
      )
    }
    expect(await grantRows(target.id)).toEqual([])
    expect(await auditRows(admin.id)).toEqual([])
  })

  it('I-ERASE-RACE-GRANTER, grant then the granter erasure: the erasure nulls the new granted_by_id', async () => {
    const a = await newAdmin('race-granter-1')
    const target = await newMember('race-granter-1')
    const held = await holdGuard(a.id)
    let granting: ReturnType<typeof settle<unknown>>
    let erasing: ReturnType<typeof settle<unknown>>
    try {
      granting = settle(operator.grant(change(a, target)))
      await untilWaiting(1)
      erasing = settle(erase(prisma, a.id, new Date()))
      await untilWaiting(2)
    } finally {
      await held.release()
    }
    expect((await granting).ok).toBe(true)
    expect((await erasing).ok).toBe(true)

    const rows = await grantRows(target.id)
    expect(
      rows.map((row) => ({
        granted_by_id: row.granted_by_id,
        revoked_at: row.revoked_at,
      }))
    ).toEqual([{ granted_by_id: null, revoked_at: null }])
    expect(
      await prisma.complimentaryAccessGrant.count({ where: { granted_by_id: a.id } })
    ).toBe(0)
  })

  it('I-ERASE-RACE-GRANTER, granter erasure then grant: the queued grant refuses the erased actor', async () => {
    const a = await newAdmin('race-granter-2')
    const target = await newMember('race-granter-2')
    const held = await holdGuard(a.id)
    let erasing: ReturnType<typeof settle<unknown>>
    let granting: ReturnType<typeof settle<unknown>>
    try {
      erasing = settle(erase(prisma, a.id, new Date()))
      await untilWaiting(1)
      granting = settle(operator.grant(change(a, target)))
      await untilWaiting(2)
    } finally {
      await held.release()
    }
    expect((await erasing).ok).toBe(true)
    const granted = await granting
    expect(granted.ok).toBe(false)
    if (!granted.ok)
      expect((granted.error as ComplimentaryAccessRefusal).code).toBe(
        'actor_erasure_requested'
      )
    expect(await grantRows(target.id)).toEqual([])
    expect(
      await prisma.complimentaryAccessGrant.count({ where: { granted_by_id: a.id } })
    ).toBe(0)
  })

  it('I-ERASE-ROLLBACK: when the grant delete fails inside erasure, the whole erasure rolls back', async () => {
    const admin = await newAdmin('rollback')
    const target = await newMember('rollback')
    const grantId = await grantBy(admin, target)
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION tea_cc614_refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'tea cc614 forced grant delete failure'; END $$`)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER tea_cc614_refuse_delete BEFORE DELETE ON "ComplimentaryAccessGrant"
        FOR EACH ROW EXECUTE FUNCTION tea_cc614_refuse_delete()`)
    try {
      const outcome = await settle(erase(prisma, target.id, new Date()))
      expect(outcome.ok).toBe(false)
      if (!outcome.ok)
        expect(String(outcome.error)).toContain('tea cc614 forced grant delete failure')
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER tea_cc614_refuse_delete ON "ComplimentaryAccessGrant"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION tea_cc614_refuse_delete()')
    }

    expect(await erasureRequest(target.id)).toBeNull()
    expect(
      (await grantRows(target.id)).map((row) => ({
        id: row.id,
        revoked_at: row.revoked_at,
      }))
    ).toEqual([{ id: grantId, revoked_at: null }])
    expect(await access.isActive(target.id)).toBe(true)
  })
})

describe('grant lifecycle as ordered pairs', () => {
  it('L-REGRANT: grant, revoke, grant again; one active row, three audit rows, cache deleted at each step', async () => {
    const admin = await newAdmin('regrant')
    const target = await newMember('regrant')

    await primeCache(target.id)
    const first = await grantBy(admin, target)
    expect(await cacheRows(target.id)).toBe(0)
    expect(await access.isActive(target.id)).toBe(true)

    await primeCache(target.id)
    await revokeBy(admin, target)
    expect(await cacheRows(target.id)).toBe(0)
    expect(await access.isActive(target.id)).toBe(false)

    await primeCache(target.id)
    const second = await grantBy(admin, target)
    expect(await cacheRows(target.id)).toBe(0)
    expect(await access.isActive(target.id)).toBe(true)

    const rows = await grantRows(target.id)
    expect(rows.map((row) => ({ id: row.id, active: row.revoked_at === null }))).toEqual([
      { id: first, active: false },
      { id: second, active: true },
    ])
    expect((await auditRows(admin.id)).map((row) => row.event_type)).toEqual([
      COMPLIMENTARY_ACCESS_GRANTED_EVENT,
      COMPLIMENTARY_ACCESS_REVOKED_EVENT,
      COMPLIMENTARY_ACCESS_GRANTED_EVENT,
    ])
  })

  it('L-REVOKE-OTHER-ADMIN: A grants, B revokes; each audit row is keyed to its own actor', async () => {
    const a = await newAdmin('other-a')
    const b = await newAdmin('other-b')
    const target = await newMember('other')
    const grantId = await grantBy(a, target)
    await revokeBy(b, target)

    const [row] = await grantRows(target.id)
    expect({
      granted_by_id: row!.granted_by_id,
      revoked_by_id: row!.revoked_by_id,
    }).toEqual({
      granted_by_id: a.id,
      revoked_by_id: b.id,
    })
    expect(await auditRows(a.id)).toEqual([
      {
        user_id: a.id,
        event_type: COMPLIMENTARY_ACCESS_GRANTED_EVENT,
        event_data: { grantId },
      },
    ])
    expect(await auditRows(b.id)).toEqual([
      {
        user_id: b.id,
        event_type: COMPLIMENTARY_ACCESS_REVOKED_EVENT,
        event_data: { grantId },
      },
    ])
    expect(await access.isActive(target.id)).toBe(false)
  })

  it('L-GRANTER-DEMOTED: the grant outlives its granter losing admin; the former admin cannot revoke, another admin can', async () => {
    const a = await newAdmin('demoted-a')
    const b = await newAdmin('demoted-b')
    const target = await newMember('demoted')
    await grantBy(a, target)
    await prisma.$executeRaw`UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE lower(email) = ${a.email}`

    expect(await access.isActive(target.id)).toBe(true)
    await refused(revokeBy(a, target), 'actor_not_admin')
    expect(await access.isActive(target.id)).toBe(true)
    expect((await auditRows(a.id)).map((row) => row.event_type)).toEqual([
      COMPLIMENTARY_ACCESS_GRANTED_EVENT,
    ])

    await revokeBy(b, target)
    expect(await access.isActive(target.id)).toBe(false)
  })

  it('L-GRANTER-ERASED-THEN-REVOKE: access holds after the granter erasure until another admin revokes', async () => {
    const a = await newAdmin('erased-granter-a')
    const b = await newAdmin('erased-granter-b')
    const target = await newMember('erased-granter')
    const grantId = await grantBy(a, target)

    await erase(prisma, a.id, new Date())
    expect(await access.isActive(target.id)).toBe(true)
    expect(
      (await operator.list(b.email)).grants.filter((row) => row.grantId === grantId)
    ).toEqual([expect.objectContaining({ granterEmail: ERASED_OPERATOR_LABEL })])

    await primeCache(target.id)
    await revokeBy(b, target)
    expect(await cacheRows(target.id)).toBe(0)
    expect(await access.isActive(target.id)).toBe(false)
    const [row] = await grantRows(target.id)
    expect({
      granted_by_id: row!.granted_by_id,
      revoked_by_id: row!.revoked_by_id,
    }).toEqual({
      granted_by_id: null,
      revoked_by_id: b.id,
    })
  })

  it('L-ERASED-THEN-REVOKE: after the member erasure, revoke and a new grant both refuse and nothing is written', async () => {
    const admin = await newAdmin('erased-member')
    const target = await newMember('erased-member')
    await grantBy(admin, target)
    await erase(prisma, target.id, new Date())
    const before = (await auditRows(admin.id)).length

    // D7: the erasure-request checks run before the active-grant check, for revoke too.
    await refused(revokeBy(admin, target), 'member_erasure_requested')
    await refused(operator.grant(change(admin, target)), 'member_erasure_requested')
    expect(await grantRows(target.id)).toEqual([])
    expect((await auditRows(admin.id)).length).toBe(before)
  })

  it('L-SELF-GRANT: an admin granting themselves, then erased, leaves no grant column naming them', async () => {
    const admin = await newAdmin('self')
    await grantBy(admin, admin)
    expect(await access.isActive(admin.id)).toBe(true)

    await erase(prisma, admin.id, new Date())
    expect(
      await prisma.complimentaryAccessGrant.count({
        where: {
          OR: [
            { member_id: admin.id },
            { granted_by_id: admin.id },
            { revoked_by_id: admin.id },
          ],
        },
      })
    ).toBe(0)
  })

  it('L-KILL-THEN-GRANT: a grant written while the kill switch is off takes effect when it opens', async () => {
    const admin = await newAdmin('kill-grant')
    const target = await newMember('kill-grant')
    await killSwitch(false)
    try {
      await grantBy(admin, target)
      expect(await access.isActive(target.id)).toBe(false)
    } finally {
      await killSwitch(true)
    }
    expect(await access.isActive(target.id)).toBe(true)
  })

  it('L-REVOKE-DURING-KILL: a revoke while the kill switch is off stays revoked when it opens', async () => {
    const admin = await newAdmin('kill-revoke')
    const target = await newMember('kill-revoke')
    await grantBy(admin, target)
    expect(await access.isActive(target.id)).toBe(true)
    await killSwitch(false)
    try {
      expect(await access.isActive(target.id)).toBe(false)
      await revokeBy(admin, target)
    } finally {
      await killSwitch(true)
    }
    expect(await access.isActive(target.id)).toBe(false)
  })

  it('L-PAID-SEQUENCE: free, grant, purchase, expiry, revoke; source and access at every step, paid row untouched by the grant', async () => {
    // Paid rows are written directly here; the webhook path is proved in
    // complimentary-access-premium.integration.spec.ts (I-WEBHOOK-KEEPS).
    const admin = await newAdmin('paid-seq')
    const target = await newMember('paid-seq')
    const step = async () => ({
      source: await premium.premiumAccessSource(target.id),
      access: await premium.hasPremiumAccess(target.id),
    })

    expect(await step()).toEqual({ source: 'none', access: false })
    await grantBy(admin, target)
    expect(await step()).toEqual({ source: 'complimentary', access: true })
    await paid(target.id, 'active')
    const paidRow = await prisma.premiumEntitlement.findUniqueOrThrow({
      where: { user_id: target.id },
    })
    expect(await step()).toEqual({ source: 'complimentary', access: true })
    await paid(target.id, 'expired')
    expect(await step()).toEqual({ source: 'complimentary', access: true })
    await revokeBy(admin, target)
    expect(await step()).toEqual({ source: 'none', access: false })

    const after = await prisma.premiumEntitlement.findUniqueOrThrow({
      where: { user_id: target.id },
    })
    expect({
      ...after,
      status: paidRow.status,
      will_renew: paidRow.will_renew,
      updated_at: paidRow.updated_at,
    }).toEqual(paidRow)
    expect(after.status).toBe('expired')
  })
})
