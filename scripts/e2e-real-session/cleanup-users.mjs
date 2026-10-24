#!/usr/bin/env node
/**
 * Deletes the local Supabase Auth users a real-session run created, and nothing else.
 *
 *   node scripts/e2e-real-session/cleanup-users.mjs
 *
 * The spec helper appends every Auth user it creates to
 * `<STORY65_REAL_SESSION_DIR>/created-identities.json` right after creating it, and
 * `run.mjs` starts every run from an empty file, so the file is exactly the run's
 * users. Each row must carry a harness address (`story65-real-<uuid>@example.test`)
 * and a UUID Auth id, or nothing is deleted. A deleted user leaves the file; a
 * failed delete stays in it, so running this again retries only what is left.
 *
 * `run.mjs` calls it when the specs finish, and CI runs it again in an `always()`
 * step, which covers a run that was killed before its own cleanup. App rows need
 * no cleanup: they live in the isolated database the run drops.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { isLoopbackHost, resolveHarnessDir, selectRecordedUsers } from './harness.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * @param {{
 *   directory: string
 *   deleteUser: (authUserId: string) => Promise<{ status: 'deleted' | 'missing' | 'failed'; reason?: string }>
 * }} options
 */
export async function deleteRecordedUsers({ directory, deleteUser }) {
  const file = path.join(directory, 'created-identities.json')
  if (!fs.existsSync(file)) return { recorded: 0, deleted: 0, missing: 0, failed: [] }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(rows)) throw new Error('created-identities.json is not a list.')
  const { deletable, refused } = selectRecordedUsers(rows)
  if (refused.length > 0)
    throw new Error(
      `Refusing to delete anything: ${refused.length} recorded row(s) are not harness users (${refused.join(', ')}).`
    )

  let deleted = 0
  let missing = 0
  /** @type {{ label: string; reason: string }[]} */
  const failed = []
  const remaining = new Set()
  for (const user of deletable) {
    const result = await deleteUser(user.authUserId)
    if (result.status === 'deleted') deleted++
    else if (result.status === 'missing') missing++
    else {
      failed.push({ label: user.label, reason: result.reason ?? 'unknown' })
      remaining.add(user.authUserId)
    }
  }
  const kept = rows.filter((row) => remaining.has(row.authUserId))
  fs.writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 })
  return { recorded: deletable.length, deleted, missing, failed }
}

/** The Auth Admin deleter for the local Supabase this run used. */
export function localAuthUserDeleter(env = process.env) {
  const url = new URL(env.SUPABASE_URL ?? '')
  if (!isLoopbackHost(url.hostname))
    throw new Error('Real-session cleanup only deletes users from a local Supabase Auth.')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is unset.')
  const admin = createClient(url.href, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return async (authUserId) => {
    const { error } = await admin.auth.admin.deleteUser(authUserId)
    if (!error) return { status: 'deleted' }
    if (error.status === 404) return { status: 'missing' }
    return { status: 'failed', reason: error.message }
  }
}

async function main() {
  const directory = resolveHarnessDir(process.env, repoRoot)
  // Built on first use, so a run that recorded nothing needs no Supabase at all.
  let deleter
  const summary = await deleteRecordedUsers({
    directory,
    deleteUser: (authUserId) => (deleter ??= localAuthUserDeleter())(authUserId),
  })
  console.log(`[real-session] Auth user cleanup: ${JSON.stringify(summary)}`)
  if (summary.failed.length > 0) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[real-session] Auth user cleanup failed: ${error.message}`)
    process.exitCode = 1
  })
}
