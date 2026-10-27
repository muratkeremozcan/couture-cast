import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { runGatesTestFile } from './node-test-gate.mjs'

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

describe('run_start deadline', () => {
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
    const { directory, capture, result } = await shellFixture(t, {
      gtimeout: 124,
      npx: 0,
    })
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

  test('mandatory native CI executes startup deadline controls before starting Supabase', async () => {
    const { parse } = await import('yaml')
    const workflow = parse(
      await readFile(
        path.join(root, '.github/workflows/pr-share-card-native.yml'),
        'utf8'
      )
    )
    const jobs = Object.values(workflow.jobs).filter((job) =>
      job.steps?.some((step) => step.uses === './.github/actions/start-local-supabase')
    )
    assert.ok(jobs.length)
    for (const job of jobs) {
      const startup = job.steps.findIndex(
        (step) => step.uses === './.github/actions/start-local-supabase'
      )
      const controls = job.steps.findIndex((step) =>
        runGatesTestFile(step.run, 'scripts/ci/supabase-start-deadline.test.mjs')
      )
      assert.ok(controls >= 0 && controls < startup)
      assert.equal(job.steps[controls].if, undefined)
      assert.equal(job.steps[controls]['continue-on-error'], undefined)
    }
  })
})
