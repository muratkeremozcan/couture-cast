import type { PrismaClient } from '@prisma/client'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import type { AuthAdminUser, SupabaseAuthAdmin } from './supabase-auth-admin'

/**
 * Story 6.17 TEA-4: Supabase Auth users that never became CoutureCast accounts.
 *
 * A Google sign-in creates an Auth user (with Google's name and avatar) before the finish
 * step knows the person's age. A closed tab, a killed app or a refusal whose Auth deletion
 * failed leaves that user behind with no account and no end date. This sweep deletes Auth
 * users older than a day whose verified address matches no account.
 *
 * Skipped on purpose: identities whose `app_metadata` names an app user or a role (staff,
 * fixtures and anything provisioned outside signup), and identities without an address, which
 * no signup or Google sign-in creates.
 * Candidates are collected across every page before any deletion, because deleting while
 * paging shifts later pages and would skip users.
 */
export const ORPHAN_AUTH_USER_MIN_AGE_MS = 24 * 60 * 60 * 1000
export const ORPHAN_AUTH_USER_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
export const ORPHAN_AUTH_USER_PAGE_SIZE = 200
/** 40,000 Auth users; a project past that needs a different sweep, so it stops loudly. */
export const ORPHAN_AUTH_USER_MAX_PAGES = 200

/**
 * TEA-14: the sweep deletes Auth users, so it runs only where it is asked for by name
 * (`ORPHAN_AUTH_USER_SWEEP_ENABLED=true`, set on the hosted production worker) and never in a
 * local or preview test environment, where the workers boot against an isolated database that
 * holds none of the local Auth server's accounts.
 */
export function orphanAuthUserSweepEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.ORPHAN_AUTH_USER_SWEEP_ENABLED !== 'true') return false
  if (env.TEST_ENV === 'local' || env.TEST_ENV === 'preview') return false
  return env.VERCEL_ENV !== 'preview'
}

export type OrphanAuthUserSweepDeps = {
  admin: Pick<SupabaseAuthAdmin, 'listUsers' | 'deleteUser'>
  prisma: PrismaClient
  logger: {
    info: (obj: object, msg: string) => void
    warn: (obj: object, msg: string) => void
  }
}

export type OrphanAuthUserSweepResult = {
  scanned: number
  deleted: number
  failed: number
}

function provisionedOutsideSignup(user: AuthAdminUser) {
  const metadata = user.appMetadata
  return ['app_user_id', 'app_role', 'role'].some((key) => {
    const value = metadata[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

function isOrphanCandidate(user: AuthAdminUser, cutoff: number) {
  const created = Date.parse(user.createdAt)
  return (
    Number.isFinite(created) &&
    created < cutoff &&
    Boolean(user.email?.trim()) &&
    !provisionedOutsideSignup(user)
  )
}

export async function sweepOrphanAuthUsers(
  deps: OrphanAuthUserSweepDeps,
  now: Date
): Promise<OrphanAuthUserSweepResult> {
  const cutoff = now.getTime() - ORPHAN_AUTH_USER_MIN_AGE_MS
  const candidates: { id: string; email: string }[] = []
  // TEA-14 pairing: the Auth server and this database must be one Supabase project. A
  // database without `auth.users` (an app-only database) sweeps nothing.
  const [paired] = await deps.prisma.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('auth.users') IS NOT NULL AS present`
  if (!paired?.present)
    throw new Error('Orphan sweep refused: this database holds no auth.users table.')

  let scanned = 0
  let page: number | null = 1
  let pages = 0
  while (page !== null) {
    if (++pages > ORPHAN_AUTH_USER_MAX_PAGES)
      // Stops before any deletion: a partial list would judge only some users.
      throw new Error(
        `Orphan sweep refused: more than ${ORPHAN_AUTH_USER_MAX_PAGES} pages.`
      )
    const result = await deps.admin.listUsers({
      page,
      perPage: ORPHAN_AUTH_USER_PAGE_SIZE,
    })
    scanned += result.users.length
    for (const user of result.users)
      if (isOrphanCandidate(user, cutoff))
        candidates.push({ id: user.id, email: (user.email ?? '').trim().toLowerCase() })
    page = result.nextPage
  }

  let deleted = 0
  let failed = 0
  for (const candidate of candidates) {
    try {
      const email = candidate.email
      // TEA-10: the finish step's address lock: a finish that lands first keeps its identity.
      const removed = await interactiveTransaction(
        deps.prisma,
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_email:' || ${email}))`
          const account = await tx.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
            select: { id: true },
          })
          if (account) return false
          // TEA-14: only an Auth user this database holds; never one from another project.
          const held = await tx.$queryRaw<unknown[]>`
            SELECT 1 FROM auth.users WHERE id = ${candidate.id}::uuid`
          if (held.length === 0) {
            deps.logger.warn({ authUserId: candidate.id }, 'orphan_auth_user_unpaired')
            return false
          }
          await deps.admin.deleteUser(candidate.id)
          return true
        },
        { maxWait: 10_000, timeout: 15_000 }
      )
      if (removed) deleted++
    } catch (err) {
      failed++
      deps.logger.warn({ err }, 'orphan_auth_user_delete_failed')
    }
  }

  const summary = { scanned, deleted, failed }
  deps.logger.info(summary, 'orphan_auth_user_sweep_completed')
  return summary
}

/** The `{ run }` shape both worker bootstraps schedule, as Story 6.13's retention does. */
export function createOrphanAuthUserSweep(
  deps: OrphanAuthUserSweepDeps,
  clock: () => Date = () => new Date()
) {
  return { run: () => sweepOrphanAuthUsers(deps, clock()) }
}
