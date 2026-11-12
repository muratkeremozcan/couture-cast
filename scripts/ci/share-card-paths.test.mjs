// Story 6.14 follow-up: Share-card native originals runs on a merge to main only when a file
// its lanes build, run or read changed (the nightly run covers everything). A merge used to
// start 10 device jobs, 4 on macOS, holding half of the account's 20 concurrent jobs for 41
// to 118 minutes. The filter must never skip a commit that touched an input.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { minimatch } from 'minimatch'
import { parse } from 'yaml'
import {
  BRIDGE_APP_DIR,
  BRIDGE_UNIT_FILES,
} from '../e2e-share-card/bridge-a11y-files.mjs'

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const workflow = parse(read('../../.github/workflows/pr-share-card-native.yml'))
const patterns = (workflow.on ?? workflow[true]).push.paths

/** GitHub's rule: a file counts when the last pattern that matches it is not negated. */
function triggers(files) {
  return files.some((file) => {
    let included = false
    for (const pattern of patterns) {
      const negated = pattern.startsWith('!')
      if (minimatch(file, negated ? pattern.slice(1) : pattern, { dot: true }))
        included = !negated
    }
    return included
  })
}

// Files no lane of this workflow builds, runs or reads. Anything else is an input.
const NOT_INPUTS = [
  '_bmad-output/**',
  '_bmad/**',
  'docs/**',
  '**/*.md',
  'k6/**',
  'pact/**',
  'infra/**',
  'playwright/tests/**',
  'playwright/config/**',
  'playwright/scripts/**',
  '.github/workflows/**',
  '.coderabbit.yaml',
  'apps/**/*.test.*',
  'apps/**/*.spec.*',
  'apps/api/integration/**',
]
// The app test files this workflow does run, from their own sources: its
// share-card-plugins gate suite and the unit files bridge-a11y.mjs runs.
const pluginSuite = [
  ...JSON.parse(read('./node-test-suites.json')).suites['share-card-plugins'],
  ...BRIDGE_UNIT_FILES.map((file) => `${BRIDGE_APP_DIR}/${file}`),
]
const isInput = (file) =>
  file === '.github/workflows/pr-share-card-native.yml' ||
  /^playwright\/tests\/share-card-[^/]+\.spec\.ts$/.test(file) ||
  pluginSuite.includes(file) ||
  !NOT_INPUTS.some((pattern) => minimatch(file, pattern, { dot: true }))

test('every input of the lanes starts a main run', () => {
  for (const file of [
    'package-lock.json',
    'package.json',
    '.nvmrc',
    'tsconfig.json',
    'packages/api-client/src/contracts/http/share-card.ts',
    'packages/utils/src/index.ts',
    'apps/api/src/modules/share-cards/share-card-renderer.ts',
    'apps/mobile/app/(tabs)/index.tsx',
    'apps/web/src/app/page.tsx',
    'supabase/migrations/20261112000000_x.sql',
    'scripts/run-story68-native.mjs',
    'scripts/lib/story68-built-render.mjs',
    'scripts/e2e-share-card/prepare.mjs',
    'scripts/ci/share-card-lanes.mjs',
    'maestro/community-feed.yaml',
    'playwright/share-card.config.ts',
    'playwright/tests/share-card-export.spec.ts',
    'playwright/support/share-card-owned-runtime.ts',
    '.github/actions/start-local-supabase/action.yml',
    '.github/workflows/pr-share-card-native.yml',
    ...pluginSuite,
  ])
    assert.ok(triggers([file]), file)
})

test('documentation and unrelated suites do not', () => {
  for (const file of [
    '_bmad-output/test-artifacts/ci-cd-pipeline.md',
    'README.md',
    'apps/mobile/README.md',
    'k6/smoke.ts',
    'pact/consumer.pact.spec.ts',
    'playwright/tests/moderation-history.spec.ts',
    '.github/workflows/pr-checks.yml',
    'apps/api/src/prisma/database-tls.spec.ts',
    'apps/api/integration/community-stream.integration.spec.ts',
    'apps/mobile/plugins/with-watchos.test.js',
  ])
    assert.equal(triggers([file]), false, file)
})

test('the last 20 commits on main: no commit that touched an input is skipped', () => {
  const commits = JSON.parse(read('./fixtures/main-commits-2026-11-12.json'))
  assert.equal(commits.length, 20)
  const skippedInputs = commits
    .filter(({ files }) => files.some(isInput) && !triggers(files))
    .map(({ sha, files }) => `${sha}: ${files.filter(isInput).join(', ')}`)
  assert.deepEqual(skippedInputs, [])
  // And the filter does skip: the commits that touched no input.
  const skipped = commits.filter(({ files }) => !triggers(files)).map(({ sha }) => sha)
  assert.deepEqual(
    skipped,
    commits.filter(({ files }) => !files.some(isInput)).map(({ sha }) => sha)
  )
})
