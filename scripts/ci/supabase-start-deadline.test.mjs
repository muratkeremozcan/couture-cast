import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const action = await readFile(
  path.join(root, '.github/actions/start-local-supabase/action.yml'),
  'utf8'
)
const runStart = action.match(/ {8}run_start\(\) \{[\s\S]*?\n {8}\}/)?.[0]
assert.ok(runStart, 'The real Supabase action must define its startup deadline')

async function shellFixture(t, commands) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cc68-supabase-deadline-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const [name, status] of Object.entries(commands))
    await writeFile(
      path.join(directory, name),
      `#!/bin/bash\nprintf '%s\\n' "$0" "$@" > "$CAPTURE"\nexit ${status}\n`,
      { mode: 0o700 }
    )
  const capture = path.join(directory, 'called-command')
  const result = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-c', `${runStart}\nexclude=realtime,studio\nrun_start 7`],
    { env: { ...process.env, PATH: directory, CAPTURE: capture }, encoding: 'utf8' }
  )
  return { directory, capture, result }
}

test('Supabase Linux startup preserves GNU timeout deadline and child exit status', async (t) => {
  const { directory, capture, result } = await shellFixture(t, {
    timeout: 42,
    gtimeout: 43,
    npx: 0,
  })
  assert.equal(result.status, 42)
  assert.deepEqual((await readFile(capture, 'utf8')).trim().split('\n'), [
    path.join(directory, 'timeout'),
    '--kill-after=15',
    '7',
    'npx',
    'supabase',
    'start',
    '--exclude',
    'realtime,studio',
  ])
})

test('Supabase macOS startup uses gtimeout when timeout is absent', async (t) => {
  const { directory, capture, result } = await shellFixture(t, { gtimeout: 124, npx: 0 })
  assert.equal(result.status, 124)
  assert.deepEqual((await readFile(capture, 'utf8')).trim().split('\n'), [
    path.join(directory, 'gtimeout'),
    '--kill-after=15',
    '7',
    'npx',
    'supabase',
    'start',
    '--exclude',
    'realtime,studio',
  ])
})

test('Supabase startup fails closed before npx when no deadline tool exists', async (t) => {
  const { capture, result } = await shellFixture(t, { npx: 0 })
  assert.equal(result.status, 2)
  assert.match(result.stdout + result.stderr, /GNU timeout or gtimeout/)
  await assert.rejects(readFile(capture), { code: 'ENOENT' })
})
