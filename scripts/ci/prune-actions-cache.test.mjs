import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import {
  cachesToPrune,
  PROTECTED_KEY_PREFIXES,
  STALE_AFTER_MS,
} from './prune-actions-cache.mjs'

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

test('a native client handed between jobs is never pruned, however long it sat unread', () => {
  // Codex review of PR 211: a prune listed an iOS client as idle for 48 hours, ios-build
  // then found it and skipped its build, the prune deleted it, and both downstream
  // restores (fail-on-cache-miss) failed. A handoff cache stays; GitHub's 7-day eviction
  // of unused entries still removes it once no job reads it.
  const caches = [
    cache(
      1,
      'refs/heads/main',
      'cc68-native-ios-v1-0123456789abcdef',
      STALE_AFTER_MS * 3
    ),
    cache(
      2,
      'refs/pull/205/merge',
      'cc68-native-android-v1-0123456789',
      STALE_AFTER_MS * 3
    ),
    cache(3, 'refs/heads/main', 'Linux-npm-old', STALE_AFTER_MS * 3),
  ]
  assert.deepEqual(
    cachesToPrune(caches, new Set(), now).map(({ id }) => id),
    [3]
  )
})

test('every restore that fails on a miss reads a protected handoff key', () => {
  const root = new URL('../../', import.meta.url)
  const workflows = readdirSync(new URL('.github/workflows/', root)).filter((name) =>
    /\.ya?ml$/.test(name)
  )
  const handoff = []
  for (const name of workflows) {
    const workflow = parse(
      readFileSync(new URL(`.github/workflows/${name}`, root), 'utf8')
    )
    for (const job of Object.values(workflow.jobs ?? {}))
      for (const step of job.steps ?? [])
        if (step.with?.['fail-on-cache-miss'] === true) handoff.push(step.with.key)
  }
  assert.ok(handoff.length >= 3, handoff.join(', '))
  // Each such key comes from scripts/ci/native-build-cache.mjs, directly or through
  // ios-build's output, and that script names its keys under the protected prefix. The one
  // exception is the client an ios-native.yml dispatch hands its own shards under
  // `dispatch-<sha>-`: its run deletes it at the end, so it stays unprotected and a prune
  // removes an orphan only once nothing has read it for STALE_AFTER_MS, long after any run.
  for (const key of handoff)
    assert.match(
      key,
      /^(dispatch-\$\{\{ inputs\.sha \}\}-)?\$\{\{ (steps\.native_key\.outputs\.key|needs\.ios-build\.outputs\.app-key) \}\}$/
    )
  assert.ok(!PROTECTED_KEY_PREFIXES.some((prefix) => 'dispatch-'.startsWith(prefix)))
  assert.ok(
    STALE_AFTER_MS >= 24 * 60 * 60 * 1000,
    'a dispatch run ends well inside the idle limit'
  )
  const source = readFileSync(new URL('scripts/ci/native-build-cache.mjs', root), 'utf8')
  assert.ok(
    PROTECTED_KEY_PREFIXES.some((prefix) => source.includes(`\`${prefix}\${platform}-`)),
    'native-build-cache.mjs keys start with a protected prefix'
  )
})
