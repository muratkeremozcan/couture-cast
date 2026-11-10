// Story 6.14 TEA, slice 7: the owner's complimentary access command end to end.
// `runComplimentaryAccessCli` runs with real arguments and a real Prisma client against a
// database this file owns, so every refusal is proven to leave that database untouched,
// and every write is proven to carry exactly one audit row with no member identity.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  COMPLIMENTARY_ACCESS_USAGE,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_USAGE,
  runComplimentaryAccessCli,
  type ComplimentaryAccessCliDeps,
} from '../src/modules/commerce/complimentary-access.cli.js'
import {
  COMPLIMENTARY_ACCESS_GRANTED_EVENT,
  COMPLIMENTARY_ACCESS_REVOKED_EVENT,
} from '../src/modules/commerce/complimentary-access-operator.service.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  insertAuthUser,
  installAuthUsers,
  seedAdmin,
} from './helpers/community-sponsorship-fixtures.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { ComplimentaryAccessService } from '../src/modules/feature-flags/complimentary-access.service.js'
import { CommunityAuthorizationBudget } from '../src/modules/community/community-availability.js'
import {
  cacheRow,
  recordingRemote,
  seedMemberFlagsOff,
} from './helpers/complimentary-access-fixtures.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const ENV_FILE = '/operator/.env.isolated'
const CANARY_REASON = 'canary-614-reason'

const CLOSED_CODES = [
  'actor_auth_user_missing',
  'actor_not_admin',
  'actor_app_user_missing',
  'actor_identity_mismatch',
  'actor_erasure_requested',
  'member_not_found',
  'member_erasure_requested',
  'already_granted',
  'no_active_grant',
  'invalid_reason',
] as const

let admin: { email: string; userId: string }

type CliRun = {
  code: number
  stdout: string[]
  stderr: string[]
  createPrisma: ReturnType<typeof vi.fn>
}

async function cli(args: readonly string[], envText?: string): Promise<CliRun> {
  const stdout: string[] = []
  const stderr: string[] = []
  const createPrisma = vi.fn(
    (url: string) => new PrismaClient({ datasources: { db: { url } } })
  )
  const deps: ComplimentaryAccessCliDeps = {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    readEnvFile: (path) => {
      if (path !== ENV_FILE) throw new Error(`unexpected env file ${path}`)
      return envText ?? `DATABASE_URL="${database.url}"\n`
    },
    createPrisma,
  }
  const code = await runComplimentaryAccessCli([...args, '--env-file', ENV_FILE], deps)
  return { code, stdout, stderr, createPrisma }
}

const grantArgs = (
  memberEmail: string,
  reason = CANARY_REASON,
  actorEmail = admin.email
) => [
  'grant',
  '--actor-email',
  actorEmail,
  '--member-email',
  memberEmail,
  '--reason',
  reason,
]
const revokeArgs = (
  memberEmail: string,
  reason = 'tea revoke',
  actorEmail = admin.email
) => [
  'revoke',
  '--actor-email',
  actorEmail,
  '--member-email',
  memberEmail,
  '--reason',
  reason,
]

async function newMember() {
  const email = `canary-614-member-${randomUUID()}@example.test`
  const user = await prisma.user.create({ data: { email } })
  return { email, id: user.id }
}

/** Every grant row and every audit row, so "nothing written" is a full comparison. */
async function snapshot() {
  return {
    grants: await prisma.complimentaryAccessGrant.findMany({ orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
    // Grant and revoke never touch billing (D5, seeded defect S-10).
    billing: {
      entitlements: await prisma.premiumEntitlement.findMany({ orderBy: { id: 'asc' } }),
      customers: await prisma.billingCustomer.findMany({ orderBy: { id: 'asc' } }),
    },
  }
}

function json(lines: readonly string[]): Record<string, unknown> {
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0]!) as Record<string, unknown>
}

function refusal(run: CliRun, code: (typeof CLOSED_CODES)[number]) {
  expect(run.code).toBe(EXIT_REFUSED)
  expect(run.stdout).toEqual([])
  expect(run.stderr).toHaveLength(1)
  expect(run.stderr[0]).toMatch(
    new RegExp(`^access:complimentary refused \\(${code}\\): `)
  )
}

/** Holds a session advisory lock in its own connection until released. */
async function holdLock(key: string) {
  const holder = new Client({ connectionString: database.url })
  await holder.connect()
  await holder.query('BEGIN')
  await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key])
  return {
    release: async () => {
      await holder.query('COMMIT')
      await holder.end()
    },
  }
}

/** Polls until `count` sessions wait on an advisory lock. No sleeps beyond the poll tick. */
async function waiters(count: number) {
  const deadline = Date.now() + 5_000
  for (;;) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'`
    if ((row?.n ?? 0) >= count) return
    if (Date.now() > deadline) throw new Error(`expected ${count} advisory waiters`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

beforeAll(async () => {
  await database.migrate()
  await prisma.$queryRaw`SELECT 1 FROM "ComplimentaryAccessGrant" LIMIT 1`
  await installAuthUsers(prisma)
  await seedMemberFlagsOff(prisma)
  admin = await seedAdmin(prisma)
}, 120_000)

afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

describe('complimentary access command', () => {
  it('I-CLI-GRANT / I-AUDIT-EXACT: grant writes one row, one audit row keyed by the actor with only the grant id, and deletes the cache row', async () => {
    const member = await newMember()
    const remote = recordingRemote()
    const cache = new CommunityFlagEvaluationService(
      prisma,
      remote.provider,
      new ComplimentaryAccessService(prisma, remote.provider)
    )
    expect(
      (await cache.evaluate(member.id, new CommunityAuthorizationBudget())).value
    ).toBe(false)
    expect(await cacheRow(prisma, member.id)).not.toBeNull()
    const before = await snapshot()

    const run = await cli(grantArgs(member.email))

    expect(run.code).toBe(EXIT_OK)
    expect(run.stderr).toEqual([])
    const out = json(run.stdout)
    expect(out).toMatchObject({ command: 'grant', target: 'local', dryRun: false })
    const grantId = out.grantId as string
    const after = await snapshot()
    expect(after.billing).toEqual(before.billing)
    expect(after.grants).toHaveLength(before.grants.length + 1)
    const row = after.grants.find((g) => g.id === grantId)!
    expect(row).toMatchObject({
      member_id: member.id,
      reason: CANARY_REASON,
      granted_by_id: admin.userId,
      revoked_at: null,
      revoked_by_id: null,
      revoke_reason: null,
    })
    const audits = after.audits.slice(before.audits.length)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      user_id: admin.userId,
      event_type: COMPLIMENTARY_ACCESS_GRANTED_EVENT,
      event_data: { grantId },
    })
    expect(COMPLIMENTARY_ACCESS_GRANTED_EVENT).toBe('complimentary_access_granted')
    const auditText = JSON.stringify(audits[0])
    for (const needle of [member.id, member.email, CANARY_REASON])
      expect(auditText).not.toContain(needle)
    expect(await cacheRow(prisma, member.id)).toBeNull()
    expect(
      (await cache.evaluate(member.id, new CommunityAuthorizationBudget())).value
    ).toBe(true)
  })

  it('I-AUDIT-EXACT (revoke): revoke stamps the row and writes one audit row with only the grant id', async () => {
    const member = await newMember()
    const grantId = json((await cli(grantArgs(member.email))).stdout).grantId as string
    const before = await snapshot()

    const run = await cli(revokeArgs(member.email, 'canary-614-revoke'))

    expect(run.code).toBe(EXIT_OK)
    expect(json(run.stdout)).toMatchObject({ command: 'revoke', grantId, dryRun: false })
    const row = await prisma.complimentaryAccessGrant.findUniqueOrThrow({
      where: { id: grantId },
    })
    expect(row.revoked_at).toBeInstanceOf(Date)
    expect(row).toMatchObject({
      revoked_by_id: admin.userId,
      revoke_reason: 'canary-614-revoke',
    })
    const afterRevoke = await snapshot()
    expect(afterRevoke.billing).toEqual(before.billing)
    const audits = afterRevoke.audits.slice(before.audits.length)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      user_id: admin.userId,
      event_type: COMPLIMENTARY_ACCESS_REVOKED_EVENT,
      event_data: { grantId },
    })
    expect(COMPLIMENTARY_ACCESS_REVOKED_EVENT).toBe('complimentary_access_revoked')
    for (const needle of [member.id, member.email, 'canary-614-revoke'])
      expect(JSON.stringify(audits[0])).not.toContain(needle)
  })

  it('I-CLI-ACTOR-NONADMIN: an actor without app_role admin writes nothing', async () => {
    const member = await newMember()
    const email = `not-admin-${randomUUID()}@example.test`
    await prisma.user.create({ data: { email } })
    await insertAuthUser(prisma, email, { app_role: 'member' })
    const before = await snapshot()

    refusal(await cli(grantArgs(member.email, CANARY_REASON, email)), 'actor_not_admin')
    expect(await snapshot()).toEqual(before)
  })

  it('I-CLI-ACTOR-MISSING: unknown actor, auth user with no app user, and mismatched identities each write nothing', async () => {
    const member = await newMember()
    const before = await snapshot()

    refusal(
      await cli(
        grantArgs(member.email, CANARY_REASON, `nobody-${randomUUID()}@example.test`)
      ),
      'actor_auth_user_missing'
    )

    const orphan = `orphan-${randomUUID()}@example.test`
    await insertAuthUser(prisma, orphan, { app_role: 'admin' })
    refusal(
      await cli(grantArgs(member.email, CANARY_REASON, orphan)),
      'actor_app_user_missing'
    )

    const authEmail = `auth-${randomUUID()}@example.test`
    const other = await prisma.user.create({
      data: { email: `other-${randomUUID()}@example.test` },
    })
    await insertAuthUser(prisma, authEmail, { app_role: 'admin', app_user_id: other.id })
    refusal(
      await cli(grantArgs(member.email, CANARY_REASON, authEmail)),
      'actor_identity_mismatch'
    )

    expect(await snapshot()).toEqual(before)
  })

  it('I-CLI-MEMBER-MISSING: an unknown member email writes nothing', async () => {
    const before = await snapshot()
    refusal(
      await cli(grantArgs(`ghost-${randomUUID()}@example.test`)),
      'member_not_found'
    )
    expect(await snapshot()).toEqual(before)
  })

  it('I-CLI-ALREADY: a second grant refuses with the existing grant id and writes nothing', async () => {
    const member = await newMember()
    const grantId = json((await cli(grantArgs(member.email))).stdout).grantId as string
    const before = await snapshot()

    const run = await cli(grantArgs(member.email, 'second'))
    refusal(run, 'already_granted')
    expect(run.stderr[0]).toContain(grantId)
    expect(await snapshot()).toEqual(before)
  })

  it('I-CLI-NO-ACTIVE: revoke with no active grant writes nothing', async () => {
    const member = await newMember()
    const before = await snapshot()
    refusal(await cli(revokeArgs(member.email)), 'no_active_grant')
    expect(await snapshot()).toEqual(before)
  })

  it('U-CLI-REASON: empty after trim, 201 characters, and whitespace-only reasons refuse invalid_reason', async () => {
    const member = await newMember()
    const before = await snapshot()
    for (const reason of ['   ', 'x'.repeat(201), '\t\n']) {
      const run = await cli(grantArgs(member.email, reason))
      // A blank value is a usage error at the parser; a present but invalid one is a refusal.
      if (run.code === EXIT_USAGE) expect(reason.trim()).toBe('')
      else refusal(run, 'invalid_reason')
    }
    expect(
      json((await cli(grantArgs(member.email, 'x'.repeat(200)))).stdout).dryRun
    ).toBe(false)
    expect((await snapshot()).grants).toHaveLength(before.grants.length + 1)
  })

  it('U-CLI-DRY-RUN: --dry-run reports the plan and writes nothing', async () => {
    const member = await newMember()
    const before = await snapshot()

    const run = await cli([...grantArgs(member.email), '--dry-run'])
    expect(run.code).toBe(EXIT_OK)
    expect(json(run.stdout)).toMatchObject({
      command: 'grant',
      dryRun: true,
      grantId: null,
    })
    expect(await snapshot()).toEqual(before)
  })

  it('U-CLI-USAGE: a missing subcommand or flag exits 2 with the usage text and connects to nothing', async () => {
    for (const args of [
      [],
      ['grant'],
      ['grant', '--actor-email', 'a@example.test'],
      ['erase'],
    ]) {
      const run = await cli(args)
      expect(run.code).toBe(EXIT_USAGE)
      expect(run.stderr.at(-1)).toBe(COMPLIMENTARY_ACCESS_USAGE)
      expect(run.createPrisma).not.toHaveBeenCalled()
    }
  })

  it('U-CLI-TARGET-AMBIENT: an ambient DATABASE_URL is ignored; only the env file targets', async () => {
    const member = await newMember()
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://ambient:ambient@db.ambientref000000.supabase.co:5432/postgres'
    )
    try {
      const run = await cli(grantArgs(member.email))
      expect(run.code).toBe(EXIT_OK)
      expect(run.createPrisma).toHaveBeenCalledWith(database.url)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('U-CLI-TARGET-REMOTE: a remote host without --confirm-target, or with the wrong ref, is refused before any client exists', async () => {
    const remoteUrl =
      'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
    const member = await newMember()
    for (const extra of [[], ['--confirm-target', 'wrongrefwrongrefwron']]) {
      const run = await cli(
        [...grantArgs(member.email), ...extra],
        `DATABASE_URL="${remoteUrl}"\n`
      )
      expect(run.code).toBe(EXIT_REFUSED)
      expect(run.stderr[0]).toMatch(/^access:complimentary refused: /)
      expect(run.createPrisma).not.toHaveBeenCalled()
    }
  })

  it('U-CLI-CODES-CLOSED / I-CLI-LOG-SCAN: grant and revoke output never carries the reason, and every refusal code is in the closed list', async () => {
    const member = await newMember()
    const grantRun = await cli(grantArgs(member.email))
    const revokeRun = await cli(revokeArgs(member.email, 'canary-614-revoke'))
    const output = [
      ...grantRun.stdout,
      ...grantRun.stderr,
      ...revokeRun.stdout,
      ...revokeRun.stderr,
    ].join('\n')
    expect(output).not.toContain(CANARY_REASON)
    expect(output).not.toContain('canary-614-revoke')
    expect(output).not.toContain(member.email)

    const codes = new Set<string>()
    for (const run of [
      await cli(revokeArgs(member.email)),
      await cli(grantArgs(`ghost-${randomUUID()}@example.test`)),
    ])
      codes.add(/\(([a-z_]+)\)/.exec(run.stderr[0]!)![1]!)
    for (const code of codes) expect(CLOSED_CODES).toContain(code)
  })

  it('I-CLI-LIST: list prints active grants only, with the granter email or [erased]', async () => {
    const active = await newMember()
    const revoked = await newMember()
    const activeId = json((await cli(grantArgs(active.email))).stdout).grantId as string
    await cli(grantArgs(revoked.email))
    await cli(revokeArgs(revoked.email))

    const run = await cli(['list', '--actor-email', admin.email])
    expect(run.code).toBe(EXIT_OK)
    const grants = json(run.stdout).grants as Record<string, unknown>[]
    const entry = grants.find((g) => g.grantId === activeId)
    expect(entry).toMatchObject({
      memberEmail: active.email,
      reason: CANARY_REASON,
      granterEmail: admin.email,
    })
    expect(grants.some((g) => g.memberEmail === revoked.email)).toBe(false)

    await prisma.complimentaryAccessGrant.update({
      where: { id: activeId },
      data: { granted_by_id: null },
    })
    const after = json((await cli(['list', '--actor-email', admin.email])).stdout)
      .grants as Record<string, unknown>[]
    expect(after.find((g) => g.grantId === activeId)?.granterEmail).toBe('[erased]')
  })

  it('I-CLI-ATOMIC: a failing audit insert leaves no grant row and the cache row in place', async () => {
    const member = await newMember()
    const remote = recordingRemote()
    const cache = new CommunityFlagEvaluationService(
      prisma,
      remote.provider,
      new ComplimentaryAccessService(prisma, remote.provider)
    )
    await cache.evaluate(member.id, new CommunityAuthorizationBudget())
    const row = await cacheRow(prisma, member.id)
    const before = await snapshot()
    const trigger = `tea_614_fail_audit_${randomUUID().replaceAll('-', '')}`
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'complimentary_access_granted' THEN RAISE EXCEPTION 'tea audit failure'; END IF;
        RETURN NEW;
      END $$`)
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`
    )
    try {
      const run = await cli(grantArgs(member.email))
      expect(run.code).toBe(EXIT_REFUSED)
      expect(await snapshot()).toEqual(before)
      expect(await cacheRow(prisma, member.id)).toEqual(row)
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "AuditLog"`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`)
    }
  })

  it('I-CLI-RACE-GRANT: two grants released together leave one row, one audit row, and the loser already_granted', async () => {
    const member = await newMember()
    const before = await snapshot()
    const held = await holdLock(`community_member:${member.id}`)
    const first = cli(grantArgs(member.email, 'race one'))
    await waiters(1)
    const second = cli(grantArgs(member.email, 'race two'))
    await waiters(2)
    await held.release()
    const runs = await Promise.all([first, second])

    expect(runs.map((run) => run.code).sort()).toEqual([EXIT_OK, EXIT_REFUSED])
    refusal(runs.find((run) => run.code === EXIT_REFUSED)!, 'already_granted')
    const after = await snapshot()
    expect(after.grants.filter((g) => g.member_id === member.id)).toHaveLength(1)
    expect(after.audits.length - before.audits.length).toBe(1)
  })

  it('I-CLI-RACE-REVOKE: two revokes released together stamp once, audit once, and the loser no_active_grant', async () => {
    const member = await newMember()
    await cli(grantArgs(member.email))
    const before = await snapshot()
    const held = await holdLock(`community_member:${member.id}`)
    const first = cli(revokeArgs(member.email, 'race one'))
    await waiters(1)
    const second = cli(revokeArgs(member.email, 'race two'))
    await waiters(2)
    await held.release()
    const runs = await Promise.all([first, second])

    expect(runs.map((run) => run.code).sort()).toEqual([EXIT_OK, EXIT_REFUSED])
    refusal(runs.find((run) => run.code === EXIT_REFUSED)!, 'no_active_grant')
    const after = await snapshot()
    expect(after.audits.length - before.audits.length).toBe(1)
    const rows = after.grants.filter((g) => g.member_id === member.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.revoke_reason).toBe('race one')
  })
})
