// Change-based lane selection (scripts/ci/lanes.mjs): real merged pull requests replayed against
// the map, the glob matcher held to minimatch, and every repository file a test reads checked
// to wake the lanes that run that test.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { minimatch } from 'minimatch'
import {
  ALL_LANES_LABEL,
  DOCS,
  DOC_INPUTS,
  LANES,
  OWNED_BY_PATH_FILTERS,
  PR_FILES_CAP,
  SHARED,
  WORKSPACES,
  classify,
  globToRegExp,
  laneInputs,
  main,
  matchesAny,
  readWorkspaceDependencies,
  selectLanes,
} from './lanes.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dependencies = readWorkspaceDependencies(root)
const inputs = laneInputs(dependencies)
const fixture = JSON.parse(
  readFileSync(
    path.join(root, 'scripts/ci/fixtures/merged-pr-files-2026-11-12.json'),
    'utf8'
  )
)
const pullRequest = (number) => {
  const found = fixture.pullRequests.find((entry) => entry.number === number)
  assert.ok(found, `#${number} is in the fixture`)
  return found.files
}
const running = (files) => {
  const plan = selectLanes({ event: 'pull_request', files, dependencies })
  return Object.keys(plan).filter((id) => plan[id].run)
}
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
const allLanes = Object.keys(LANES)

test('the glob matcher agrees with minimatch on every tracked file and every glob the map uses', () => {
  const globs = [
    ...new Set(
      [...DOCS, ...SHARED, ...OWNED_BY_PATH_FILTERS, ...Object.values(inputs).flat()].map(
        (glob) => glob.replace(/^!/, '')
      )
    ),
  ]
  for (const glob of globs) {
    const regExp = globToRegExp(glob)
    for (const file of tracked)
      assert.equal(
        regExp.test(file),
        minimatch(file, glob, { dot: true }),
        `${glob} against ${file}`
      )
  }
})

test('a later ! glob removes what an earlier glob added, as in a GitHub path filter', () => {
  assert.equal(matchesAny('apps/web/a.ts', ['apps/**', '!apps/web/**']), false)
  assert.equal(
    matchesAny('apps/web/a.ts', ['apps/**', '!apps/web/**', 'apps/web/a.ts']),
    true
  )
})

test('workspace dependencies come from the manifests, plus the inputs no manifest declares', () => {
  assert.ok(dependencies.web.includes('api-client'))
  assert.ok(dependencies['api-client'].includes('utils'))
  assert.ok(
    dependencies.api.includes('db'),
    'the API runs the Prisma client from packages/db'
  )
  assert.ok(!dependencies.mobile.includes('db'))
})

test('a docs-only pull request runs no lane (#199 minus the runbook the API specs read)', () => {
  const docs = [
    'docs/guide.md',
    'apps/web/README.md',
    '_bmad-output/notes/plan.md',
    'LICENSE',
  ]
  assert.deepEqual(running(docs), [])
  const plan = selectLanes({ event: 'pull_request', files: docs, dependencies })
  assert.match(plan.maestro.reason, /no file this lane builds, runs or reads changed/)
})

test('a doc a test reads wakes the lane that runs the test (#199)', () => {
  const files = pullRequest(199)
  assert.ok(files.includes('_bmad-output/project-knowledge/deployment-guide.md'))
  assert.deepEqual(running(files), ['coverage-api'])
})

test('an API-only pull request skips Maestro, native and the web-only lanes (#209, #180)', () => {
  for (const number of [209, 180]) {
    const lanes = running(pullRequest(number))
    for (const id of [
      'typecheck',
      'coverage-api',
      'community',
      'contract',
      'web-e2e',
      'preview',
    ])
      assert.ok(lanes.includes(id), `#${number} runs ${id}`)
    for (const id of ['maestro', 'watchos', 'coverage-mobile', 'lighthouse'])
      assert.ok(!lanes.includes(id), `#${number} skips ${id}`)
  }
})

test('a mobile-only pull request skips the web, API and preview lanes (#204, #192)', () => {
  for (const number of [204, 192]) {
    assert.deepEqual(running(pullRequest(number)), [
      'typecheck',
      'coverage-mobile',
      'playwright-unit',
      'maestro',
      'share-card',
      'watchos',
    ])
  }
})

test('a shared package wakes every workspace that depends on it (#202: packages/testing)', () => {
  const lanes = running(['packages/testing/src/index.ts'])
  for (const id of [
    'coverage-api',
    'coverage-mobile',
    'coverage-other',
    'year-ahead',
    'web-e2e',
  ])
    assert.ok(lanes.includes(id), id)
  const config = running(['packages/config/src/flags.ts'])
  for (const id of ['coverage-api', 'coverage-other', 'year-ahead', 'community'])
    assert.ok(config.includes(id), id)
  for (const id of ['maestro', 'coverage-mobile', 'watchos'])
    assert.ok(
      !config.includes(id),
      `apps/mobile does not depend on @couture/config: ${id}`
    )
  const utils = running(['packages/utils/src/index.ts'])
  for (const id of [
    'coverage-api',
    'coverage-mobile',
    'maestro',
    'lighthouse',
    'web-e2e',
  ])
    assert.ok(utils.includes(id), id)
})

test('workflows, scripts, root configuration and unclaimed paths run every lane', () => {
  for (const file of [
    '.github/workflows/pr-checks.yml',
    '.github/actions/node-dependencies/action.yml',
    'scripts/ci/lanes.mjs',
    'package-lock.json',
    '.nvmrc',
    'brand-new-top-level/file.ts',
  ])
    assert.deepEqual(running([file]), allLanes, file)
  const plan = selectLanes({
    event: 'pull_request',
    files: ['apps/api/src/main.ts', 'package-lock.json'],
    dependencies,
  })
  assert.match(plan.maestro.reason, /package-lock\.json changed, which every lane reads/)
})

test('every replayed pull request that touched a shared file runs every lane', () => {
  for (const { number, files } of fixture.pullRequests) {
    const shared = files.some((file) =>
      ['shared', 'unclaimed'].includes(classify(file, inputs).kind)
    )
    if (shared) assert.deepEqual(running(files), allLanes, `#${number}`)
  }
})

test('pushes, schedules, manual runs, the label and an unreadable diff run every lane', () => {
  const docs = ['docs/guide.md']
  for (const event of ['push', 'schedule', 'workflow_dispatch'])
    assert.ok(
      Object.values(selectLanes({ event, files: docs, dependencies })).every(
        (lane) => lane.run
      ),
      event
    )
  const labelled = selectLanes({
    event: 'pull_request',
    files: docs,
    labels: [ALL_LANES_LABEL],
    dependencies,
  })
  assert.ok(Object.values(labelled).every((lane) => lane.run))
  assert.match(labelled.maestro.reason, /ALL-LANES label/)
  const unread = selectLanes({ event: 'pull_request', files: null, dependencies })
  assert.ok(Object.values(unread).every((lane) => lane.run))
  const capped = selectLanes({
    event: 'pull_request',
    files: Array.from({ length: PR_FILES_CAP }, (_, i) => `docs/${i}.md`),
    dependencies,
  })
  assert.ok(Object.values(capped).every((lane) => lane.run))
})

// Which lanes run the tests under each path. A file a test reads must wake every one of them.
const TEST_RUNNERS = [
  ['apps/api/**', ['coverage-api']],
  ['apps/mobile/**', ['coverage-mobile']],
  ['apps/web/**', ['coverage-other']],
  ['packages/**', ['coverage-other']],
  ['playwright/support/helpers/**', ['playwright-unit']],
  ['playwright/**', ['web-e2e']],
  ['scripts/**', ['share-card']],
]
const isTest = (file) => /\.(test|spec)\.(m?[jt]sx?|cjs)$/.test(file)

const trackedSet = new Set(tracked)
const trackedDirs = new Set(
  tracked.flatMap((file) =>
    file
      .split('/')
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join('/'))
  )
)

/**
 * Repository files a source names in a string literal, root-relative or relative to it, comments
 * left out. A literal naming a directory three or more levels deep stands for every file under
 * it, which catches paths a test builds from a directory and a file name; shallower ones
 * (`apps/api`) are working directories and labels far more often than reads.
 */
function filesNamed(source, file) {
  const named = new Set()
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
  for (const [, , literal] of code.matchAll(
    /(['"`])((?:\.{1,2}\/)*[\w@.-]+(?:\/[\w@.-]+)+)\/?\1/g
  )) {
    for (const candidate of [
      path.posix.normalize(literal),
      path.posix.join(path.posix.dirname(file), literal),
    ]) {
      const withExtension = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js']
        .map((suffix) => `${candidate}${suffix}`)
        .find((name) => trackedSet.has(name))
      if (withExtension) named.add(withExtension)
      else if (trackedDirs.has(candidate) && candidate.split('/').length >= 3)
        for (const inside of tracked)
          if (inside.startsWith(`${candidate}/`)) named.add(inside)
    }
  }
  // A workspace package import reads that workspace; any path inside it stands for it.
  for (const [, name] of code.matchAll(/['"]@couture\/([\w-]+)/g))
    if (WORKSPACES[name]) named.add(`${WORKSPACES[name]}/package.json`)
  return [...named]
}

// Paths a test names as sample input to the code it tests, not files it reads.
const NOT_READ = [
  ['apps/api/integration/vercel-storage.spec.ts', 'apps/web/src/app/page.tsx'],
  ['scripts/ci/share-card-paths.test.mjs', 'playwright/tests/moderation-history.spec.ts'],
  [
    'scripts/ci/share-card-paths.test.mjs',
    '_bmad-output/test-artifacts/ci-cd-pipeline.md',
  ],
]

test('every repository file a test names wakes the lanes that run that test', () => {
  const misses = []
  // This file names repository paths only as sample input to the lane map.
  for (const file of tracked
    .filter(isTest)
    .filter((name) => name !== 'scripts/ci/lanes.test.mjs')) {
    const runners =
      TEST_RUNNERS.find(([glob]) => minimatch(file, glob, { dot: true }))?.[1] ?? []
    if (runners.length === 0) continue
    const source = readFileSync(path.join(root, file), 'utf8')
    for (const read of filesNamed(source, file)) {
      if (NOT_READ.some(([test, sample]) => test === file && sample === read)) continue
      const woken = classify(read, inputs).lanes
      const missing = runners.filter((id) => !woken.includes(id))
      if (missing.length > 0)
        misses.push(`${file} reads ${read}; ${missing.join(', ')} must wake`)
    }
  }
  assert.deepEqual(misses, [])
})

test('DOC_INPUTS names only files that exist and lanes that exist', () => {
  for (const [file, lanes] of Object.entries(DOC_INPUTS)) {
    assert.ok(tracked.includes(file), file)
    for (const id of lanes) assert.ok(id in LANES, `${file}: ${id}`)
  }
})

test('the plan job writes one output per lane and a summary, and runs everything on an API failure', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lanes-'))
  const eventPath = path.join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7 } }))
  const env = {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_TOKEN: 'token',
    GITHUB_OUTPUT: path.join(dir, 'output'),
    GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
    LANES_WORKFLOW: 'pr-mobile-e2e.yml',
  }
  const requested = []
  const fetchImpl = async (url) => {
    requested.push(url)
    if (url.includes('/labels')) return Response.json([{ name: 'documentation' }])
    if (url.includes('page=1'))
      return Response.json([
        { filename: 'apps/mobile/app/index.tsx' },
        { filename: 'docs/new.md', previous_filename: 'docs/old.md' },
      ])
    return Response.json([])
  }
  const plan = await main({ env, root, fetchImpl })
  assert.equal(plan.maestro.run, true)
  assert.equal(plan['web-e2e'].run, false)
  const output = readFileSync(env.GITHUB_OUTPUT, 'utf8')
  const planOutput = JSON.parse(output.match(/^plan=(.*)$/m)[1])
  assert.deepEqual(Object.keys(planOutput), allLanes)
  assert.equal(planOutput.maestro, true)
  assert.equal(planOutput['web-e2e'], false)
  assert.deepEqual(JSON.parse(output.match(/^coverage_shards=(.*)$/m)[1]), ['mobile'])
  const summaryText = readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')
  assert.match(summaryText, /Mobile end-to-end \(Maestro\) \| pr-mobile-e2e\.yml \| runs/)
  assert.doesNotMatch(
    summaryText,
    /pr-checks\.yml/,
    'the summary keeps to the workflow named'
  )
  assert.ok(requested.some((url) => url.includes('/repos/owner/repo/pulls/7/files')))

  const failing = await main({
    env: { ...env, GITHUB_OUTPUT: path.join(dir, 'output2') },
    root,
    fetchImpl: async () => new Response('', { status: 502 }),
  })
  assert.ok(Object.values(failing).every((lane) => lane.run))
})
