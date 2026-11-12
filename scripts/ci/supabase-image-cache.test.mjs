// The image cache key, computed from package-lock.json before the install, must equal the
// one start-local-supabase computed from the installed CLI, so existing cache entries hit.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { cliVersionFromLock, supabaseImageCacheKey } from './supabase-image-cache.mjs'

const lock = readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')

test('the CLI version from the lockfile is the installed one', () => {
  const installed = createRequire(import.meta.url)('supabase/package.json').version
  assert.equal(cliVersionFromLock(lock), installed)
})

test('the key matches the shell form the start action used', () => {
  const exclude =
    'realtime,studio,postgres-meta,logflare,vector,edge-runtime,supavisor,mailpit,imgproxy'
  const configHash = 'a'.repeat(64)
  const shellExclude = execFileSync(
    'bash',
    ['-c', 'printf "%s" "$EXCLUDE" | shasum -a 256 | cut -c1-16'],
    { env: { ...process.env, EXCLUDE: exclude }, encoding: 'utf8' }
  ).trim()
  assert.equal(
    supabaseImageCacheKey({
      runnerOs: 'Linux',
      runnerArch: 'X64',
      cliVersion: '2.62.5',
      configHash,
      exclude,
    }),
    `supabase-images-v2-Linux-X64-cli2.62.5-config${'a'.repeat(16)}-exclude${shellExclude}`
  )
})
