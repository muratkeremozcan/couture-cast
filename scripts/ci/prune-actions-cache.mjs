// Story 6.14 follow-up: keep the Actions cache under its 10 GB limit by removing what no job
// will read again, so GitHub's own eviction never pushes out a live key. On 2026-11-12 the
// cache held 10.28 GB: entries of merged pull requests and keys their lockfile or browser
// version had superseded, while the Supabase image and AVD caches every e2e shard reads sat
// one eviction away from a cold path.
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** An entry no job has read for this long has been superseded by a newer key. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000

/**
 * The caches to delete, each with its reason: every cache of a pull request that is no longer
 * open, and every cache nobody has read for STALE_AFTER_MS. A key a job still reads stays.
 * @param {{ id: number, ref: string, key: string, size_in_bytes: number, last_accessed_at: string }[]} caches
 * @param {Set<number>} openPullRequests
 * @param {number} now
 */
export function cachesToPrune(caches, openPullRequests, now) {
  const prune = []
  for (const cache of caches) {
    const pull = /^refs\/pull\/(\d+)\/merge$/.exec(cache.ref)
    if (pull && !openPullRequests.has(Number(pull[1]))) {
      prune.push({ ...cache, reason: `pull request #${pull[1]} is closed` })
      continue
    }
    const idle = now - Date.parse(cache.last_accessed_at)
    if (Number.isFinite(idle) && idle > STALE_AFTER_MS)
      prune.push({
        ...cache,
        reason: `not read for ${Math.floor(idle / 3_600_000)} hours`,
      })
  }
  return prune
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository) throw new Error('GITHUB_REPOSITORY is required')
  const caches = JSON.parse(
    gh([
      'api',
      '--paginate',
      '--slurp',
      `repos/${repository}/actions/caches?per_page=100`,
    ])
  ).flatMap((page) => page.actions_caches)
  const open = new Set(
    JSON.parse(
      gh([
        'pr',
        'list',
        '-R',
        repository,
        '--state',
        'open',
        '--limit',
        '500',
        '--json',
        'number',
      ])
    ).map((pr) => pr.number)
  )
  const prune = cachesToPrune(caches, open, Date.now())
  let freed = 0
  for (const cache of prune) {
    // DRY_RUN=true lists what would go and deletes nothing.
    if (process.env.DRY_RUN !== 'true')
      gh(['cache', 'delete', String(cache.id), '-R', repository])
    freed += cache.size_in_bytes
    console.log(
      `${process.env.DRY_RUN === 'true' ? 'Would delete' : 'Deleted'} ${cache.key} (${cache.ref}): ${cache.reason}`
    )
  }
  const total = caches.reduce((sum, cache) => sum + cache.size_in_bytes, 0)
  console.log(
    `Pruned ${prune.length} of ${caches.length} caches, ${(freed / 1e9).toFixed(2)} of ${(total / 1e9).toFixed(2)} GB.`
  )
}
