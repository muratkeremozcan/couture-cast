#!/usr/bin/env node
/**
 * Deletes the local Supabase Auth users a real-session run created, and nothing else.
 *
 *   node scripts/e2e-real-session/cleanup-users.mjs
 *
 * The spec helper records every Auth user it creates in
 * `<STORY65_REAL_SESSION_DIR>/created-identities.json`, write-ahead (`identities.mjs`):
 * a pending row with the address goes in before the Auth Admin call, and the full
 * row with the Auth id replaces it after. `run.mjs` starts every run from an empty
 * file, so the file is exactly the run's users. A created row must carry a harness
 * address (`story65-real-<uuid>@example.test`) and a UUID Auth id; a pending row a
 * harness address and no id, which is resolved here through the Auth Admin user
 * list. One row of any other shape and nothing is deleted. A deleted or absent
 * user leaves the file; a failed delete stays in it, so running this again retries
 * only what is left.
 *
 * `run.mjs` calls it once every process it started has exited, and CI runs it
 * again in an `always()` step, which covers a run that was killed before its own
 * cleanup. App rows need no cleanup: they live in the isolated database the run
 * drops.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  REAL_SESSION_EMAIL,
  isLoopbackHost,
  resolveHarnessDir,
  selectRecordedUsers,
} from './harness.mjs'
import { IDENTITIES_FILE, readIdentities, writeIdentities } from './identities.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** The key a settled row is removed from the file under. */
function rowKey(row) {
  return row.pending === true ? `pending:${row.email}` : `auth:${row.authUserId}`
}

/**
 * Deletes every recorded user, then rewrites the file without the rows it settled.
 *
 * The rewrite re-reads the file and removes only the rows this call deleted or
 * found gone, with no await between the read and the write. A row appended while a
 * delete was in flight is therefore kept for the next cleanup; writing back the
 * snapshot read at the start would erase the only record of that user.
 *
 * @param {{
 *   directory: string
 *   deleteUser: (authUserId: string) => Promise<{ status: 'deleted' | 'missing' | 'failed'; reason?: string }>
 *   findUserByEmail?: (email: string) => Promise<{ status: 'found'; authUserId: string } | { status: 'absent' } | { status: 'failed'; reason?: string }>
 * }} options
 */
export async function deleteRecordedUsers({ directory, deleteUser, findUserByEmail }) {
  if (!fs.existsSync(path.join(directory, IDENTITIES_FILE)))
    return { recorded: 0, deleted: 0, missing: 0, failed: [] }
  const { deletable, pending, refused } = selectRecordedUsers(readIdentities(directory))
  if (refused.length > 0)
    throw new Error(
      `Refusing to delete anything: ${refused.length} recorded row(s) are not harness users (${refused.join(', ')}).`
    )

  let deleted = 0
  let missing = 0
  /** @type {{ label: string; reason: string }[]} */
  const failed = []
  /** Keys of the rows settled: their user is deleted or does not exist. */
  const settled = new Set()
  const remove = async (authUserId, label, keys) => {
    const result = await deleteUser(authUserId)
    if (result.status === 'failed') {
      failed.push({ label, reason: result.reason ?? 'unknown' })
      return
    }
    if (result.status === 'deleted') deleted++
    else missing++
    for (const key of keys) settled.add(key)
  }
  for (const user of deletable)
    await remove(user.authUserId, user.label, [
      `auth:${user.authUserId}`,
      `pending:${user.email}`,
    ])
  for (const row of pending) {
    const found = findUserByEmail
      ? await findUserByEmail(row.email)
      : { status: 'failed', reason: 'no Auth user lookup was given' }
    if (found.status === 'failed') {
      failed.push({ label: row.label, reason: found.reason ?? 'unknown' })
    } else if (found.status === 'absent') {
      missing++
      settled.add(`pending:${row.email}`)
    } else {
      await remove(found.authUserId, row.label, [
        `pending:${row.email}`,
        `auth:${found.authUserId}`,
      ])
    }
  }

  // Synchronous from here: the current rows, minus the settled ones.
  const kept = readIdentities(directory).filter((row) => !settled.has(rowKey(row)))
  writeIdentities(directory, kept)
  return { recorded: deletable.length + pending.length, deleted, missing, failed }
}

/** The Auth Admin calls cleanup makes against the local Supabase this run used. */
export function localAuthUsers(env = process.env) {
  const url = new URL(env.SUPABASE_URL ?? '')
  if (!isLoopbackHost(url.hostname))
    throw new Error('Real-session cleanup only deletes users from a local Supabase Auth.')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is unset.')
  const admin = createClient(url.href, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const perPage = 1000
  return {
    /** @param {string} authUserId */
    async deleteUser(authUserId) {
      const { error } = await admin.auth.admin.deleteUser(authUserId)
      if (!error) return /** @type {const} */ ({ status: 'deleted' })
      if (error.status === 404) return /** @type {const} */ ({ status: 'missing' })
      return /** @type {const} */ ({ status: 'failed', reason: error.message })
    },
    /**
     * The Auth id of a harness address, read from the Admin user list. Any other
     * address is refused, so this can never resolve a user the run did not create.
     *
     * @param {string} email
     */
    async findUserByEmail(email) {
      if (!REAL_SESSION_EMAIL.test(email))
        return /** @type {const} */ ({
          status: 'failed',
          reason: 'not a harness address',
        })
      for (let page = 1; ; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
        if (error)
          return /** @type {const} */ ({ status: 'failed', reason: error.message })
        const match = data.users.find((user) => user.email?.toLowerCase() === email)
        if (match) return /** @type {const} */ ({ status: 'found', authUserId: match.id })
        if (data.users.length < perPage)
          return /** @type {const} */ ({ status: 'absent' })
      }
    },
  }
}

async function main() {
  const directory = resolveHarnessDir(process.env, repoRoot)
  // Built on first use, so a run that recorded nothing needs no Supabase at all.
  /** @type {ReturnType<typeof localAuthUsers> | undefined} */
  let auth
  const summary = await deleteRecordedUsers({
    directory,
    deleteUser: (authUserId) => (auth ??= localAuthUsers()).deleteUser(authUserId),
    findUserByEmail: (email) => (auth ??= localAuthUsers()).findUserByEmail(email),
  })
  console.log(`[real-session] Auth user cleanup: ${JSON.stringify(summary)}`)
  if (summary.failed.length > 0) process.exitCode = 1
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`[real-session] Auth user cleanup failed: ${error.message}`)
    process.exitCode = 1
  })
}
