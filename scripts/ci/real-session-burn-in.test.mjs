import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { COMPARE_FILES_CAP } from './lanes.mjs'
import {
  BURN_IN_REPEATS,
  RUN_SCRIPT,
  burnIn,
  burnInCommand,
  burnInSpecs,
  childEnv,
  tagsConsentCases,
} from './real-session-burn-in.mjs'

// Sample paths under a folder that does not exist: the lane read guard (lanes.test.mjs) treats a
// named repository file as one this test reads.
const LANDING = 'playwright/tests/sample/signed-in-landing-real-session.spec.ts'
const GOOGLE = 'playwright/tests/sample/google-sign-in-real-session.spec.ts'
const IDENTITY = 'playwright/tests/sample/community-real-session-identity.spec.ts'
const sources = {
  [LANDING]: "test('L-1: lands', async () => {})",
  [GOOGLE]: 'const CONSENT_REQUIRED = { tag: CONSENT_REQUIRED_TAG }',
  [IDENTITY]: "test('literal', { tag: '@consent-required' }, async () => {})",
}
const io = { exists: () => true, read: (file) => sources[file] ?? '' }
const capped = (count) => Array.from({ length: count }, (_, i) => `docs/page-${i}.md`)

test('burns in only the changed real-session specs, once each, sorted', () => {
  assert.deepEqual(
    burnInSpecs(
      [
        LANDING,
        'apps/web/src/app/page.tsx',
        IDENTITY,
        'playwright/tests/sample/guardian-consent-ui.spec.ts',
        'playwright/tests/sample/community-feed.spec.ts',
        // Matches the real-session pattern but sits outside playwright/tests/.
        'playwright/support/sample/community-real-session.spec.ts',
        LANDING,
      ],
      'off',
      io
    ),
    [IDENTITY, LANDING]
  )
})

test('the consent pass keeps only the changed specs that tag consent cases', () => {
  assert.deepEqual(
    burnInSpecs([LANDING, GOOGLE, IDENTITY], 'required_13_15', io),
    [IDENTITY, GOOGLE].sort()
  )
  assert.deepEqual(burnInSpecs([LANDING], 'required_13_15', io), [])
})

test('a spec tags consent cases by the shared constant or the literal tag', () => {
  assert.equal(tagsConsentCases(sources[GOOGLE]), true)
  assert.equal(tagsConsentCases(sources[IDENTITY]), true)
  assert.equal(tagsConsentCases(sources[LANDING]), false)
})

test('leaves out a real-session spec the change deleted or renamed away', () => {
  assert.deepEqual(
    burnInSpecs(
      ['playwright/tests/sample/guest-preview-real-session.spec.ts', IDENTITY],
      'off',
      {
        ...io,
        exists: (file) => file !== IDENTITY,
      }
    ),
    ['playwright/tests/sample/guest-preview-real-session.spec.ts']
  )
})

test('burns in nothing when no real-session spec changed', () => {
  assert.deepEqual(
    burnInSpecs(
      ['apps/web/src/app/page.tsx', 'playwright/tests/sample/community-feed.spec.ts'],
      'off',
      io
    ),
    []
  )
})

test('below the comparison file cap only the changed specs burn in', () => {
  const all = () => {
    throw new Error('read the whole checkout below the cap')
  }
  assert.deepEqual(
    burnInSpecs([...capped(COMPARE_FILES_CAP - 2), LANDING], 'off', { ...io, all }),
    [LANDING]
  )
})

test('at the comparison file cap every real-session spec burns in', () => {
  assert.deepEqual(
    burnInSpecs(capped(COMPARE_FILES_CAP), 'off', {
      ...io,
      all: () => [GOOGLE, 'playwright/tests/sample/community-feed.spec.ts', LANDING],
    }),
    [GOOGLE, LANDING]
  )
})

test('at the cap the checkout itself lists the specs, by policy', () => {
  // Read from the checkout, so no spec is named here (the lane read guard, lanes.test.mjs).
  const off = burnInSpecs(capped(COMPARE_FILES_CAP), 'off')
  const consent = burnInSpecs(capped(COMPARE_FILES_CAP), 'required_13_15')
  const lane =
    /(community-real-session(-identity)?|guest-preview-real-session|google-sign-in-real-session|signed-in-landing-real-session)\.spec\.ts$/
  assert.equal(off.length, 5)
  assert.deepEqual(off, [...off].sort())
  for (const file of off) {
    assert.ok(file.startsWith('playwright/tests/') && lane.test(file), file)
    assert.ok(fs.existsSync(new URL(`../../${file}`, import.meta.url)), file)
  }
  assert.equal(consent.length, 1)
  assert.ok(off.includes(consent[0]))
  assert.match(consent[0], /google-sign-in-real-session\.spec\.ts$/)
})

test('runs run.mjs directly: the specs three times, no retries, on the existing web build', () => {
  assert.equal(BURN_IN_REPEATS, 3)
  assert.deepEqual(burnInCommand([LANDING]), [
    'scripts/e2e-real-session/run.mjs',
    '--skip-web-build',
    LANDING,
    '--repeat-each=3',
    '--retries=0',
  ])
  assert.ok(fs.existsSync(new URL(`../../${RUN_SCRIPT}`, import.meta.url)))
})

test('matches the burn-in repeat count of the Playwright burn-in config', () => {
  const config = fs.readFileSync(
    new URL('../../playwright/config/.burn-in.config.ts', import.meta.url),
    'utf8'
  )
  assert.match(config, new RegExp(`repeatEach: ${BURN_IN_REPEATS},`))
})

test('the run gets the job environment without the GitHub token', () => {
  assert.deepEqual(childEnv({ GITHUB_TOKEN: 'ghs_x', PATH: '/bin', BASE_SHA: 'a' }), {
    PATH: '/bin',
    BASE_SHA: 'a',
  })
})

/** A child process stand-in that records signals and exits when told. */
function fakeChild() {
  const child = new EventEmitter()
  child.signals = []
  child.kill = (signal) => child.signals.push(signal)
  return child
}

const event = {
  GITHUB_REPOSITORY: 'owner/repo',
  BASE_SHA: 'b'.repeat(40),
  HEAD_SHA: 'c'.repeat(40),
  GITHUB_TOKEN: 'ghs_secret',
  PATH: '/bin',
}

test('burnIn runs the selected specs, forwards signals and returns the run exit code', async () => {
  const child = fakeChild()
  const signals = new EventEmitter()
  const calls = []
  const lists = []
  const done = burnIn({
    env: event,
    list: async (request) => (
      lists.push(request),
      [LANDING, 'apps/web/src/app/page.tsx']
    ),
    start: (command, args, options) => (calls.push({ command, args, options }), child),
    io,
    log: () => undefined,
    signals,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(lists, [
    {
      repository: 'owner/repo',
      base: 'b'.repeat(40),
      head: 'c'.repeat(40),
      token: 'ghs_secret',
    },
  ])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, process.execPath)
  assert.deepEqual(calls[0].args, burnInCommand([LANDING]))
  assert.deepEqual(calls[0].options.env, childEnv(event))
  assert.equal(calls[0].options.stdio, 'inherit')
  signals.emit('SIGTERM', 'SIGTERM')
  signals.emit('SIGINT', 'SIGINT')
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGINT'])
  child.emit('exit', 7, null)
  assert.equal(await done, 7)
  assert.equal(signals.listenerCount('SIGTERM'), 0)
  assert.equal(signals.listenerCount('SIGINT'), 0)
})

test('burnIn fails when the run dies on a signal', async () => {
  const child = fakeChild()
  const done = burnIn({
    env: event,
    list: async () => [LANDING],
    start: () => child,
    io,
    log: () => undefined,
    signals: new EventEmitter(),
  })
  await new Promise((resolve) => setImmediate(resolve))
  child.emit('exit', null, 'SIGTERM')
  assert.equal(await done, 1)
})

test('burnIn starts nothing and passes when no spec fits the policy', async () => {
  const lines = []
  const code = await burnIn({
    env: { ...event, GUARDIAN_CONSENT_POLICY: 'required_13_15' },
    list: async () => [LANDING],
    start: () => assert.fail('started a run with nothing to burn in'),
    io,
    log: (line) => lines.push(line),
    signals: new EventEmitter(),
  })
  assert.equal(code, 0)
  assert.deepEqual(lines, [
    '[real-session-burn-in] No changed real-session spec for policy required_13_15.',
  ])
})

test('burnIn fails when the comparison cannot be read', async () => {
  await assert.rejects(
    burnIn({
      env: event,
      list: async () => {
        throw new Error('GET the comparison answered 502')
      },
      start: () => assert.fail('started a run without a file list'),
      io,
      log: () => undefined,
      signals: new EventEmitter(),
    }),
    /answered 502/
  )
})

const job = () =>
  parse(
    fs.readFileSync(
      new URL('../../.github/workflows/pr-pw-e2e-local.yml', import.meta.url),
      'utf8'
    )
  ).jobs['real-session-e2e']

const BURN_IN_IF =
  "${{ !cancelled() && github.event_name == 'pull_request' && !contains(github.event.pull_request.labels.*.name, 'SKIP_BURN_IN') && steps.supabase.outcome == 'success' }}"

for (const [name, dir, policy] of [
  ['Burn in changed real-session specs', '.real-session-e2e-burn-in', undefined],
  [
    'Burn in changed real-session guardian consent cases',
    '.real-session-e2e-burn-in-consent',
    'required_13_15',
  ],
]) {
  test(`the real-session job wires "${name}" on its own run directory`, () => {
    const steps = job().steps
    const names = steps.map((step) => step.name)
    const index = names.indexOf(name)
    assert.ok(
      index > names.indexOf('Run real-session specs'),
      'after the web build it reuses'
    )
    const step = steps[index]
    assert.equal(step.run, 'node scripts/ci/real-session-burn-in.mjs')
    assert.equal(step.if, BURN_IN_IF)
    assert.equal(step['timeout-minutes'], 7)
    assert.deepEqual(step.env, {
      GITHUB_TOKEN: '${{ github.token }}',
      BASE_SHA: '${{ github.event.pull_request.base.sha }}',
      HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
      ...(policy ? { GUARDIAN_CONSENT_POLICY: policy } : {}),
      STORY65_REAL_SESSION_DIR: `\${{ github.workspace }}/${dir}`,
    })
    const cleanup = steps.find(
      (candidate) =>
        candidate.run === 'node scripts/e2e-real-session/cleanup-users.mjs' &&
        candidate.env?.STORY65_REAL_SESSION_DIR === step.env.STORY65_REAL_SESSION_DIR
    )
    assert.ok(cleanup, 'a cleanup step deletes the Auth users the burn-in created')
    assert.equal(cleanup.if, 'always()')
    const scan = steps.find((candidate) => candidate.id === 'burn_in_secret_scan')
    assert.ok(
      scan.run.includes(`"\${{ github.workspace }}/${dir}"`),
      'its output is scanned'
    )
    const upload = steps.find(
      (candidate) => candidate.name === 'Upload redacted real-session burn-in artifacts'
    )
    assert.ok(upload.with.path.includes(`\${{ github.workspace }}/${dir}/artifacts`))
  })
}

test('burn-in output ships only after the secret scan passed', () => {
  const steps = job().steps
  const scan = steps.find((candidate) => candidate.id === 'burn_in_secret_scan')
  assert.equal(scan.if, 'always()')
  assert.match(scan.run, /artifacts\.mjs verify/)
  assert.match(scan.run, /check-artifact-secrets\.mjs/)
  assert.match(scan.run, /--reject-jwt/)
  const upload = steps.find(
    (candidate) => candidate.name === 'Upload redacted real-session burn-in artifacts'
  )
  assert.equal(
    upload.if,
    "always() && steps.burn_in_secret_scan.outcome == 'success' && steps.burn_in_secret_scan.outputs.found == '1'"
  )
  assert.ok(steps.indexOf(upload) > steps.indexOf(scan))
})
