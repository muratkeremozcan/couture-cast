// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA red spec (TEA-4): the daily sweep that deletes Supabase auth users who never
// became an account. A Google sign-in creates the auth user, with the person's Google name,
// photo and address, before the finish step; a person who leaves there would otherwise keep
// that data in Supabase with no end date. The Auth Admin API is doubled; the database is real so
// the case-insensitive match and the address lock are the production ones.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  ORPHAN_AUTH_USER_MAX_PAGES,
  sweepOrphanAuthUsers,
} from '../src/modules/auth/orphan-auth-user-sweep.js'
import type { AuthAdminUser } from '../src/modules/auth/supabase-auth-admin.js'
import {
  ORPHAN_AUTH_USER_SWEEP_CRON_PATTERN,
  ORPHAN_AUTH_USER_SWEEP_JOB_NAME,
  ORPHAN_AUTH_USER_SWEEP_TIMEZONE,
} from '../src/workers/maintenance.scheduler.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })

const HOUR = 3_600_000
const now = new Date()
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const address = () => `sweep-${randomUUID()}@synthetic.test`

function authUser(overrides: Partial<AuthAdminUser> = {}): AuthAdminUser {
  return {
    id: randomUUID(),
    email: address(),
    createdAt: ago(25 * HOUR),
    appMetadata: { provider: 'google', providers: ['google'] },
    ...overrides,
  }
}

/** Registers auth users in this database's `auth.users`, as Supabase's own database holds them. */
async function pair(users: AuthAdminUser[]) {
  for (const user of users)
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${user.id}::uuid, ${user.email}) ON CONFLICT DO NOTHING`
}

/** Every listed user is paired with this database unless named in `unpaired`. */
async function harness(pages: AuthAdminUser[][], unpaired: AuthAdminUser[] = []) {
  await pair(pages.flat().filter((user) => !unpaired.includes(user)))
  const deleted: string[] = []
  const listUsers = vi.fn(({ page }: { page: number; perPage: number }) =>
    Promise.resolve({
      users: pages[page - 1] ?? [],
      nextPage: page < pages.length ? page + 1 : null,
    })
  )
  const deleteUser = vi.fn((authUserId: string) => {
    deleted.push(authUserId)
    return Promise.resolve()
  })
  const logger = { info: vi.fn(), warn: vi.fn() }
  return {
    deps: { admin: { listUsers, deleteUser }, prisma, logger },
    listUsers,
    deleteUser,
    deleted,
    logger,
  }
}

beforeAll(async () => {
  await database.migrate()
  // The integration database has an `auth` schema but no Auth tables; this is the slice of
  // Supabase's `auth.users` the pairing guard (TEA-14) reads.
  await prisma.$executeRaw`CREATE TABLE auth.users (id uuid PRIMARY KEY, email text)`
}, 60_000)

afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

describe('A-SWEEP-ELIGIBLE: only orphans older than 24 hours are deleted', () => {
  it('deletes exactly the orphans past 24 hours and keeps everything else', async () => {
    const accountAddress = address()
    await prisma.user.create({ data: { email: accountAddress } })
    const caseVariant = address()
    await prisma.user.create({ data: { email: caseVariant } })

    const fresh = authUser({ createdAt: ago(24 * HOUR - 60_000) })
    const exactly24 = authUser({ createdAt: ago(24 * HOUR) })
    const stale = authUser({ createdAt: ago(24 * HOUR + 60_000) })
    const veryStale = authUser({ createdAt: ago(30 * 24 * HOUR) })
    const withAccount = authUser({
      email: accountAddress,
      createdAt: ago(90 * 24 * HOUR),
    })
    const caseMatch = authUser({ email: caseVariant.toUpperCase() })
    const trustedUser = authUser({
      appMetadata: { provider: 'email', app_user_id: 'user-1' },
    })
    const appRole = authUser({
      appMetadata: { provider: 'email', app_role: 'moderator' },
    })
    const role = authUser({ appMetadata: { provider: 'email', role: 'admin' } })
    const noAddress = authUser({ email: null })

    const { deps, deleted } = await harness([
      [fresh, exactly24, stale, veryStale, withAccount],
      [caseMatch, trustedUser, appRole, role, noAddress],
    ])
    const result = await sweepOrphanAuthUsers(deps, now)

    // No address means nothing can match an account, so the sweep leaves it alone (Google
    // identities always carry one).
    expect(deleted.sort()).toEqual([stale.id, veryStale.id].sort())
    expect(result).toEqual({ scanned: 10, deleted: 2, failed: 0 })
  })

  it('never deletes an auth user whose address has an account, at any age', async () => {
    const email = address()
    await prisma.user.create({
      data: { email, profile: { create: { preferences: {} } } },
    })
    const { deps, deleted } = await harness([
      [authUser({ email, createdAt: ago(365 * 24 * HOUR) })],
    ])
    expect(await sweepOrphanAuthUsers(deps, now)).toEqual({
      scanned: 1,
      deleted: 0,
      failed: 0,
    })
    expect(deleted).toEqual([])
  })
})

describe('A-SWEEP-PAGES: every page is read; failures are counted, logged and survived', () => {
  it('reads pages in order until nextPage is null', async () => {
    const pages = [[authUser()], [authUser()], [authUser()]]
    const { deps, listUsers, deleted } = await harness(pages)
    expect(await sweepOrphanAuthUsers(deps, now)).toEqual({
      scanned: 3,
      deleted: 3,
      failed: 0,
    })
    expect(listUsers.mock.calls.map(([options]) => options.page)).toEqual([1, 2, 3])
    expect(deleted).toEqual(pages.flat().map((user) => user.id))
  })

  it('a failed deletion is logged without the address and the sweep continues', async () => {
    const failing = authUser()
    const after = authUser()
    const { deps, deleteUser, deleted, logger } = await harness([[failing, after]])
    deleteUser.mockImplementationOnce(() => Promise.reject(new Error('Auth Admin 500')))
    expect(await sweepOrphanAuthUsers(deps, now)).toEqual({
      scanned: 2,
      deleted: 1,
      failed: 1,
    })
    expect(deleted).toEqual([after.id])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify([...logger.warn.mock.calls, ...logger.info.mock.calls])
    for (const user of [failing, after]) expect(logged).not.toContain(user.email!)
  })

  it('a listUsers failure stops the run before any deletion', async () => {
    const { deps, listUsers, deleteUser } = await harness([[authUser()]])
    listUsers.mockImplementationOnce(() => Promise.reject(new Error('Auth Admin down')))
    await expect(sweepOrphanAuthUsers(deps, now)).rejects.toThrow('Auth Admin down')
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('a failure on a later page rejects before any deletion', async () => {
    // Candidates are collected across every page first: deleting while paging shifts pages.
    const first = authUser()
    const { deps, listUsers, deleteUser } = await harness([[first], [authUser()]])
    listUsers
      .mockImplementationOnce(() => Promise.resolve({ users: [first], nextPage: 2 }))
      .mockImplementationOnce(() => Promise.reject(new Error('page 2 down')))
    await expect(sweepOrphanAuthUsers(deps, now)).rejects.toThrow('page 2 down')
    expect(deleteUser).not.toHaveBeenCalled()
  })
})

describe('A-SWEEP-LOCK (TEA-1 applied to the sweep): a finish in flight wins', () => {
  it('waits for the address lock and keeps an auth user whose account was just created', async () => {
    const email = address()
    const stale = authUser({ email })
    const { deps, deleteUser, deleted } = await harness([[stale]])
    let sweep: Promise<unknown> | undefined
    // Hold the lock the federated finish holds, create the account inside it, then commit.
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_email:' || ${email.toLowerCase()}))`
        sweep = sweepOrphanAuthUsers(deps, now)
        await tx.user.create({ data: { email } })
        // Either the sweep is now waiting on this lock, or (without the lock) it already deleted.
        await vi.waitFor(
          async () => {
            const waiting = await prisma.$queryRaw<{ count: bigint }[]>`
              SELECT count(*)::bigint AS count FROM pg_locks
              WHERE locktype = 'advisory' AND NOT granted`
            expect(deleteUser.mock.calls.length > 0 || waiting[0]!.count > 0n).toBe(true)
          },
          { timeout: 10_000, interval: 25 }
        )
      },
      { timeout: 20_000 }
    )
    expect(await sweep).toEqual({ scanned: 1, deleted: 0, failed: 0 })
    expect(deleted).toEqual([])
  })
})

describe('A-SWEEP-SCHEDULE: daily at 04:00 UTC', () => {
  it('pins the job name, pattern and timezone', () => {
    expect(ORPHAN_AUTH_USER_SWEEP_JOB_NAME).toBe('orphan-auth-user-sweep')
    expect(ORPHAN_AUTH_USER_SWEEP_CRON_PATTERN).toBe('0 4 * * *')
    expect(ORPHAN_AUTH_USER_SWEEP_TIMEZONE).toBe('UTC')
  })
})

describe('A-SWEEP-PAIRING (TEA-14): only an Auth server paired with this database is swept', () => {
  it('never deletes an auth user that this database does not hold in auth.users', async () => {
    const paired = authUser()
    const foreign = authUser()
    const { deps, deleted, logger } = await harness([[paired, foreign]], [foreign])
    expect(await sweepOrphanAuthUsers(deps, now)).toEqual({
      scanned: 2,
      deleted: 1,
      failed: 0,
    })
    expect(deleted).toEqual([paired.id])
    expect(logger.warn).toHaveBeenCalled()
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(foreign.email!)
  })
})

describe('A-SWEEP-REFUSALS: the sweep stops before deleting when it cannot see everything', () => {
  it('refuses past ORPHAN_AUTH_USER_MAX_PAGES pages before any deletion', async () => {
    const users = [authUser(), authUser()]
    const { deps, listUsers, deleteUser } = await harness([users])
    listUsers.mockImplementation(({ page }: { page: number; perPage: number }) =>
      Promise.resolve({ users, nextPage: page + 1 })
    )
    await expect(sweepOrphanAuthUsers(deps, now)).rejects.toThrow(
      `more than ${ORPHAN_AUTH_USER_MAX_PAGES} pages`
    )
    expect(listUsers).toHaveBeenCalledTimes(ORPHAN_AUTH_USER_MAX_PAGES)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses before listing when this database has no auth.users table', async () => {
    const other = isolatedCommunityDatabase()
    await other.migrate()
    const otherPrisma = new PrismaClient({ datasources: { db: { url: other.url } } })
    try {
      const { deps, listUsers, deleteUser } = await harness([[authUser(), authUser()]])
      await expect(
        sweepOrphanAuthUsers({ ...deps, prisma: otherPrisma }, now)
      ).rejects.toThrow('holds no auth.users table')
      expect(listUsers).not.toHaveBeenCalled()
      expect(deleteUser).not.toHaveBeenCalled()
    } finally {
      await otherPrisma.$disconnect()
      await other.drop()
    }
  }, 60_000)
})
