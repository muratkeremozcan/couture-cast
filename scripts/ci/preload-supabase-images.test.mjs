// Story 6.14 follow-up: jobs load the cached Supabase images in the background while the
// dependencies install (preload-supabase-images), and start-local-supabase waits for that
// load instead of running its own, about 77 s per job before.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../../', import.meta.url))
const action = parse(
  readFileSync(
    path.join(root, '.github/actions/preload-supabase-images/action.yml'),
    'utf8'
  )
)
const startAction = parse(
  readFileSync(path.join(root, '.github/actions/start-local-supabase/action.yml'), 'utf8')
)
const step = (name) => action.runs.steps.find((candidate) => candidate.name === name)

function runLoad(t, { hit, zstd, docker }) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'preload-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const bin = path.join(temp, 'bin')
  const cache = path.join(temp, 'cache')
  for (const dir of [bin, cache]) spawnSync('mkdir', ['-p', dir])
  writeFileSync(path.join(cache, 'images.tar.zst'), 'images')
  writeFileSync(path.join(cache, 'registry'), 'ghcr.io')
  // GNU timeout's calling form (macOS has none): drop the options and the limit, run the rest.
  const timeout = 'while [[ "$1" == --* ]]; do shift; done; shift; exec "$@"'
  for (const [name, body] of Object.entries({ zstd, docker, timeout }))
    writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
  const result = spawnSync(
    'bash',
    ['-e', '-c', step('Load the Supabase images in the background').run],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin`,
        RUNNER_TEMP: temp,
        KEY: 'supabase-images-v2-key',
        CACHE_DIR: cache,
        HIT: hit,
      },
    }
  )
  const preload = path.join(temp, 'supabase-preload')
  const statusFile = path.join(preload, 'status')
  const until = Date.now() + 10_000
  while (hit === 'true' && !existsSync(statusFile) && Date.now() < until)
    spawnSync('sleep', ['0.1'])
  const read = (name) =>
    existsSync(path.join(preload, name))
      ? readFileSync(path.join(preload, name), 'utf8').trim()
      : null
  return { result, key: read('key'), hit: read('hit'), status: read('status') }
}

test('a hit loads in the background and records the key and the outcome', (t) => {
  const loaded = runLoad(t, {
    hit: 'true',
    zstd: 'cat "$2"',
    docker: 'cat > /dev/null; exit 0',
  })
  assert.equal(loaded.result.status, 0, loaded.result.stderr)
  assert.equal(loaded.key, 'supabase-images-v2-key')
  assert.equal(loaded.hit, 'true')
  assert.equal(loaded.status, 'loaded')
  const failed = runLoad(t, {
    hit: 'true',
    zstd: 'cat "$2"',
    docker: 'cat > /dev/null; exit 1',
  })
  assert.equal(failed.status, 'failed')
})

test('a miss records only the key, and the start pulls and saves', (t) => {
  const miss = runLoad(t, { hit: 'false', zstd: 'exit 1', docker: 'exit 1' })
  assert.equal(miss.result.status, 0, miss.result.stderr)
  assert.equal(miss.hit, 'false')
  assert.equal(miss.status, null)
})

test('the preload and the start compute the key with one script', () => {
  for (const steps of [action.runs.steps, startAction.runs.steps]) {
    const key = steps.find((candidate) => candidate.id === 'cache-key')
    assert.equal(key.run, 'node scripts/ci/supabase-image-cache.mjs')
    assert.equal(key.env.CONFIG_HASH, "${{ hashFiles('supabase/config.toml') }}")
  }
  assert.equal(
    action.inputs.exclude.default,
    startAction.inputs.exclude.default,
    'the default exclude lists match'
  )
})

test('every job that starts Supabase preloads right after its ports, with the same exclude list', () => {
  const dir = path.join(root, '.github/workflows')
  const sites = []
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.yml'))) {
    const workflow = parse(readFileSync(path.join(dir, file), 'utf8'))
    for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = job.steps ?? []
      const start = steps.find((s) => s.uses === './.github/actions/start-local-supabase')
      if (!start) continue
      const site = `${file}:${name}`
      sites.push(site)
      // Right after the ports, or after the disk is freed where a job frees it: the
      // image archive needs the room.
      const ports = steps.findIndex(
        (s) => s.uses === './.github/actions/configure-ci-supabase-ports'
      )
      const after =
        steps[ports + 1]?.uses === './.github/actions/free-runner-disk' ? 2 : 1
      const preload = steps[ports + after]
      assert.equal(preload?.uses, './.github/actions/preload-supabase-images', site)
      assert.equal(preload.with?.exclude, start.with?.exclude, site)
    }
  }
  assert.ok(sites.length >= 10, sites.join(', '))
})
