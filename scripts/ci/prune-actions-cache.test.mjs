import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cachesToPrune, STALE_AFTER_MS } from './prune-actions-cache.mjs'

const now = Date.parse('2026-11-12T14:00:00Z')
const at = (msAgo) => new Date(now - msAgo).toISOString()
const cache = (id, ref, key, msAgo) => ({
  id,
  ref,
  key,
  size_in_bytes: 1,
  last_accessed_at: at(msAgo),
})

test('closed pull requests and keys nobody reads go; live keys stay', () => {
  const caches = [
    cache(1, 'refs/heads/main', 'avd-Linux--34', 60_000),
    cache(2, 'refs/heads/main', 'Linux-npm-old-lockfile', STALE_AFTER_MS + 60_000),
    cache(3, 'refs/heads/main', 'Linux-npm-current-lockfile', 3_600_000),
    cache(4, 'refs/pull/205/merge', 'node-cache', 60_000),
    cache(5, 'refs/pull/211/merge', 'node-cache', 60_000),
    cache(6, 'refs/pull/211/merge', 'playwright-old', STALE_AFTER_MS + 1),
  ]
  const pruned = cachesToPrune(caches, new Set([207, 211]), now)
  assert.deepEqual(
    pruned.map(({ id, reason }) => [id, reason]),
    [
      [2, 'not read for 48 hours'],
      [4, 'pull request #205 is closed'],
      [6, 'not read for 48 hours'],
    ]
  )
})

test('an entry read within the window stays even on a closed branch name it does not match', () => {
  assert.deepEqual(
    cachesToPrune(
      [cache(1, 'refs/heads/feature', 'key', STALE_AFTER_MS - 1)],
      new Set(),
      now
    ),
    []
  )
})
