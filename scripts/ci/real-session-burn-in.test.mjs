import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { COMPARE_FILES_CAP } from './lanes.mjs'
import { BURN_IN_REPEATS, burnInCommand, burnInSpecs } from './real-session-burn-in.mjs'

const present = () => true

test('burns in only the changed real-session specs, once each, sorted', () => {
  assert.deepEqual(
    burnInSpecs(
      [
        'playwright/tests/signed-in-landing-real-session.spec.ts',
        'apps/web/src/app/page.tsx',
        'playwright/tests/community-real-session-identity.spec.ts',
        'playwright/tests/guardian-consent-ui.spec.ts',
        'playwright/tests/community-feed.spec.ts',
        'playwright/support/helpers/real-session-harness.spec.ts',
        'playwright/tests/signed-in-landing-real-session.spec.ts',
      ],
      { exists: present }
    ),
    [
      'playwright/tests/community-real-session-identity.spec.ts',
      'playwright/tests/signed-in-landing-real-session.spec.ts',
    ]
  )
})

test('leaves out a real-session spec the change deleted or renamed away', () => {
  assert.deepEqual(
    burnInSpecs(
      [
        'playwright/tests/guest-preview-real-session.spec.ts',
        'playwright/tests/community-real-session.spec.ts',
      ],
      { exists: (file) => file !== 'playwright/tests/community-real-session.spec.ts' }
    ),
    ['playwright/tests/guest-preview-real-session.spec.ts']
  )
})

test('burns in nothing when no real-session spec changed', () => {
  assert.deepEqual(
    burnInSpecs(
      ['apps/web/src/app/page.tsx', 'playwright/tests/community-feed.spec.ts'],
      {
        exists: present,
      }
    ),
    []
  )
})

test('burns in every real-session spec when the comparison reaches its file cap', () => {
  const files = Array.from({ length: COMPARE_FILES_CAP }, (_, i) => `docs/page-${i}.md`)
  assert.deepEqual(
    burnInSpecs(files, {
      exists: present,
      all: () => [
        'playwright/tests/google-sign-in-real-session.spec.ts',
        'playwright/tests/community-feed.spec.ts',
        'playwright/tests/community-real-session.spec.ts',
      ],
    }),
    [
      'playwright/tests/community-real-session.spec.ts',
      'playwright/tests/google-sign-in-real-session.spec.ts',
    ]
  )
})

test('every real-session spec in the checkout is found when the cap is reached', () => {
  const files = Array.from({ length: COMPARE_FILES_CAP }, (_, i) => `docs/page-${i}.md`)
  assert.deepEqual(burnInSpecs(files), [
    'playwright/tests/community-real-session-identity.spec.ts',
    'playwright/tests/community-real-session.spec.ts',
    'playwright/tests/google-sign-in-real-session.spec.ts',
    'playwright/tests/guest-preview-real-session.spec.ts',
    'playwright/tests/signed-in-landing-real-session.spec.ts',
  ])
})

test('runs the specs three times with no retries on the existing web build', () => {
  assert.equal(BURN_IN_REPEATS, 3)
  assert.deepEqual(
    burnInCommand(['playwright/tests/signed-in-landing-real-session.spec.ts']),
    [
      'run',
      'test:pw-real-session',
      '--',
      '--skip-web-build',
      'playwright/tests/signed-in-landing-real-session.spec.ts',
      '--repeat-each=3',
      '--retries=0',
    ]
  )
})

test('matches the burn-in repeat count of the Playwright burn-in config', () => {
  const config = fs.readFileSync(
    new URL('../../playwright/config/.burn-in.config.ts', import.meta.url),
    'utf8'
  )
  assert.match(config, new RegExp(`repeatEach: ${BURN_IN_REPEATS},`))
})

test('the real-session job burns in changed specs on pull requests, on its own run directory', () => {
  const workflow = parse(
    fs.readFileSync(
      new URL('../../.github/workflows/pr-pw-e2e-local.yml', import.meta.url),
      'utf8'
    )
  )
  const steps = workflow.jobs['real-session-e2e'].steps
  const names = steps.map((step) => step.name)
  const index = names.indexOf('Burn in changed real-session specs')
  assert.ok(
    index > names.indexOf('Run real-session specs'),
    'after the web build it reuses'
  )
  const step = steps[index]
  assert.equal(step.run, 'node scripts/ci/real-session-burn-in.mjs')
  assert.equal(
    step.if,
    "${{ !cancelled() && github.event_name == 'pull_request' && steps.supabase.outcome == 'success' }}"
  )
  assert.deepEqual(step.env, {
    GITHUB_TOKEN: '${{ github.token }}',
    BASE_SHA: '${{ github.event.pull_request.base.sha }}',
    HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
    STORY65_REAL_SESSION_DIR: '${{ github.workspace }}/.real-session-e2e-burn-in',
  })
  const cleanup = steps.find(
    (candidate) =>
      candidate.run === 'node scripts/e2e-real-session/cleanup-users.mjs' &&
      candidate.env?.STORY65_REAL_SESSION_DIR === step.env.STORY65_REAL_SESSION_DIR
  )
  assert.ok(cleanup, 'a cleanup step deletes the Auth users the burn-in created')
  assert.equal(cleanup.if, 'always()')
})
