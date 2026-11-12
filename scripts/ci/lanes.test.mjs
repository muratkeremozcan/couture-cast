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

test('an API-only pull request runs Maestro, whose journeys call the API, and skips native and web-only lanes (#209, #180)', () => {
  for (const number of [209, 180]) {
    const lanes = running(pullRequest(number))
    for (const id of [
      'typecheck',
      'coverage-api',
      'community',
      'contract',
      'web-e2e',
      'preview',
      'maestro',
    ])
      assert.ok(lanes.includes(id), `#${number} runs ${id}`)
    for (const id of ['watchos', 'coverage-mobile', 'lighthouse'])
      assert.ok(!lanes.includes(id), `#${number} skips ${id}`)
  }
})

// What each lane starts or builds, and so must wake it. Maestro starts local Supabase, resets
// the database, starts the API with its workers and Metro (pr-mobile-e2e.yml,
// scripts/run-maestro.mjs); every Playwright entry point runs prepare:playwright, which
// generates the Prisma client and builds config, utils, api-client and testing.
const STARTS = {
  typecheck: [
    'apps/web/src/app/page.tsx',
    'packages/k6-utils/src/index.ts',
    'k6/smoke.js',
  ],
  lighthouse: [
    'apps/web/src/app/page.tsx',
    'packages/config/src/flags.ts',
    'packages/testing/src/index.ts',
    'packages/utils/src/index.ts',
    'packages/db/prisma/schema.prisma',
  ],
  'coverage-api': [
    'apps/api/src/main.ts',
    'packages/db/prisma/schema.prisma',
    'packages/config/src/flags.ts',
    'supabase/migrations/20260101000000_x.sql',
  ],
  'coverage-mobile': [
    'apps/mobile/app/index.tsx',
    'packages/api-client/src/index.ts',
    'apps/web/src/i18n/locales/en-US.json',
  ],
  'coverage-other': [
    'apps/web/src/app/page.tsx',
    'packages/db/test/x.spec.ts',
    'apps/api/src/main.ts',
  ],
  'year-ahead': [
    'apps/api/src/main.ts',
    'apps/web/src/app/page.tsx',
    'packages/config/src/flags.ts',
  ],
  community: ['apps/api/src/main.ts', 'supabase/migrations/20260101000000_x.sql'],
  contract: [
    'apps/api/src/main.ts',
    'pact/consumer.pact.spec.ts',
    'packages/api-client/src/index.ts',
  ],
  'web-e2e': [
    'apps/web/src/app/page.tsx',
    'apps/api/src/main.ts',
    'packages/db/prisma/schema.prisma',
    'packages/config/src/flags.ts',
    'supabase/config.toml',
    'supabase/migrations/20260101000000_x.sql',
    'playwright/tests/home.spec.ts',
  ],
  preview: [
    'apps/web/src/app/page.tsx',
    'apps/api/src/main.ts',
    'packages/db/prisma/schema.prisma',
    'packages/config/src/flags.ts',
    'playwright/tests/home.spec.ts',
  ],
  'playwright-unit': [
    'playwright/support/helpers/advisory-lock.ts',
    'maestro/premium-subscription.yaml',
    'apps/mobile/src/lib/premium.ts',
  ],
  maestro: [
    'maestro/premium-subscription.yaml',
    'apps/mobile/src/lib/premium.ts',
    'apps/api/src/main.ts',
    'packages/db/prisma/schema.prisma',
    'packages/config/src/flags.ts',
    'packages/api-client/src/index.ts',
    'supabase/config.toml',
    'supabase/seed.sql',
    'supabase/migrations/20260101000000_x.sql',
  ],
  'share-card': [
    'apps/mobile/app/index.tsx',
    'apps/web/src/app/page.tsx',
    'apps/api/src/main.ts',
    'supabase/migrations/20260101000000_x.sql',
    'playwright/tests/share-card-export.spec.ts',
  ],
  watchos: ['apps/mobile/plugins/with-watchos.js', 'apps/mobile/targets/watch/App.swift'],
}

// Per lane, the replayed pull requests it skips. The other 51 touched a shared or unclaimed
// path and ran everything. #199 changed docs and one runbook the API specs read; #148 changed
// Playwright specs and helpers; #204 and #192 the mobile app only; #209, #208 and #180 the API
// (#208 with packages/db). A change here is a change in what CI checks: review each entry.
const EXPECTED_SKIPS = {
  typecheck: [199],
  lighthouse: [209, 204, 199, 192, 180, 148],
  'coverage-api': [204, 192],
  'coverage-mobile': [209, 208, 199, 180, 148],
  'coverage-other': [204, 199, 192, 148],
  'year-ahead': [204, 199, 192, 148],
  community: [204, 199, 192, 148],
  contract: [204, 199, 192, 148],
  'web-e2e': [204, 199, 192],
  preview: [204, 199, 192],
  'playwright-unit': [209, 199, 180],
  maestro: [199, 148],
  'share-card': [199],
  watchos: [209, 208, 199, 180, 148],
}

test('each lane skips exactly the replayed pull requests reviewed for it', () => {
  const skips = Object.fromEntries(allLanes.map((id) => [id, []]))
  for (const { number, files } of fixture.pullRequests) {
    const plan = selectLanes({ event: 'pull_request', files, dependencies })
    for (const id of allLanes) if (!plan[id].run) skips[id].push(number)
  }
  assert.deepEqual(skips, EXPECTED_SKIPS)
})

test('every lane wakes on each file of what it starts or builds', () => {
  assert.deepEqual(Object.keys(STARTS).sort(), [...allLanes].sort())
  const misses = []
  for (const [id, files] of Object.entries(STARTS))
    for (const file of files)
      if (!running([file]).includes(id)) misses.push(`${id}: ${file}`)
  assert.deepEqual(misses, [])
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
  // Maestro runs on it: the API its journeys call reads the flag configuration.
  assert.ok(config.includes('maestro'))
  for (const id of ['coverage-mobile', 'watchos'])
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
function filesNamed(source, file, modules = new Set()) {
  const named = new Set()
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
  for (const match of code.matchAll(
    /(['"`])((?:\.{1,2}\/)*[\w@.-]+(?:\/[\w@.-]+)+)\/?\1/g
  )) {
    const literal = match[2]
    const imported = /\b(?:from|import|require)\s*\(?\s*$/.test(
      code.slice(Math.max(0, match.index - 20), match.index)
    )
    for (const candidate of [
      path.posix.normalize(literal),
      path.posix.join(path.posix.dirname(file), literal),
    ]) {
      const withExtension = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js']
        .map((suffix) => `${candidate}${suffix}`)
        .find((name) => trackedSet.has(name))
      if (withExtension) {
        named.add(withExtension)
        if (imported && CODE.test(withExtension) && !isTest(withExtension))
          modules.add(withExtension)
      } else if (trackedDirs.has(candidate) && candidate.split('/').length >= 3)
        for (const inside of tracked)
          if (inside.startsWith(`${candidate}/`)) named.add(inside)
    }
  }
  // A workspace package import reads that workspace; any path inside it stands for it.
  for (const [, name] of code.matchAll(/['"]@couture\/([\w-]+)/g))
    if (WORKSPACES[name]) named.add(`${WORKSPACES[name]}/package.json`)
  return [...named]
}

const CODE = /\.(m?[jt]sx?|cjs)$/
// Modules whose path literals are data they hand to other code: the lane map names every
// lane's inputs, and the flow-state helper passes Maestro flow paths to the CLI.
const NAMES_WITHOUT_READING = new Set([
  'scripts/ci/lanes.mjs',
  'scripts/lib/mobile-e2e-flow-state.mjs',
])

/**
 * Files a test reads: what it names, then what each source module it names goes on to name, so
 * a path read through a helper the test imports counts as read by the test.
 */
function filesRead(file) {
  const read = new Set()
  const seen = new Set([file])
  const queue = [file]
  while (queue.length > 0) {
    const current = queue.shift()
    const modules = new Set()
    const source = readFileSync(path.join(root, current), 'utf8')
    for (const named of filesNamed(source, current, modules)) read.add(named)
    for (const module of modules)
      if (!seen.has(module) && !NAMES_WITHOUT_READING.has(module)) {
        seen.add(module)
        queue.push(module)
      }
  }
  return [...read]
}

// Paths a test names only as sample input to the code it tests.
const NOT_READ = [
  ['apps/api/integration/vercel-storage.spec.ts', 'apps/web/src/app/page.tsx'],
  ['apps/api/integration/vercel-storage.spec.ts', 'packages/k6-utils/src/index.ts'],
  ['scripts/ci/share-card-paths.test.mjs', 'playwright/tests/moderation-history.spec.ts'],
  [
    'scripts/ci/share-card-paths.test.mjs',
    '_bmad-output/test-artifacts/ci-cd-pipeline.md',
  ],
]

test('every repository file a test or a module it imports names wakes the lanes that run that test', () => {
  const misses = []
  // This file names repository paths only as sample input to the lane map.
  for (const file of tracked
    .filter(isTest)
    .filter((name) => name !== 'scripts/ci/lanes.test.mjs')) {
    const runners =
      TEST_RUNNERS.find(([glob]) => minimatch(file, glob, { dot: true }))?.[1] ?? []
    if (runners.length === 0) continue
    for (const read of filesRead(file)) {
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

const HEAD = 'a'.repeat(40)
const EVENT = { pull_request: { number: 7, head: { sha: HEAD } } }

test('the plan job writes one output per lane and a summary, and runs everything on an API failure', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lanes-'))
  const eventPath = path.join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify(EVENT))
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
    if (url.endsWith('/pulls/7')) return Response.json({ head: { sha: HEAD } })
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

test('the label is read from every page, so ALL-LANES past the first hundred still counts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lanes-labels-'))
  const eventPath = path.join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify(EVENT))
  const fetchImpl = async (url) => {
    if (url.endsWith('/pulls/7')) return Response.json({ head: { sha: HEAD } })
    if (url.includes('/labels')) {
      const page = Number(new URL(url).searchParams.get('page') ?? '1')
      if (page === 1)
        return Response.json(
          Array.from({ length: 100 }, (_, i) => ({ name: `label-${i}` }))
        )
      if (page === 2) return Response.json([{ name: ALL_LANES_LABEL }])
      return Response.json([])
    }
    if (url.includes('page=1')) return Response.json([{ filename: 'docs/guide.md' }])
    return Response.json([])
  }
  const plan = await main({
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'token',
    },
    root,
    fetchImpl,
  })
  assert.ok(Object.values(plan).every((lane) => lane.run))
})

test('a pull request whose head moved past the commit under test runs every lane', async () => {
  // The files API answers for the pull request's head now; a rerun of an older commit, or a
  // push while the plan reads, must not plan that commit from another commit's files.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lanes-head-'))
  const eventPath = path.join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify(EVENT))
  const fetchImpl = async (url) => {
    if (url.endsWith('/pulls/7')) return Response.json({ head: { sha: 'b'.repeat(40) } })
    if (url.includes('/labels')) return Response.json([])
    if (url.includes('page=1')) return Response.json([{ filename: 'docs/guide.md' }])
    return Response.json([])
  }
  const plan = await main({
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'token',
    },
    root,
    fetchImpl,
  })
  assert.ok(Object.values(plan).every((lane) => lane.run))
  assert.match(plan.maestro.reason, /head moved/)
})

test('a plan that fails to compute runs every lane and still writes its outputs', async () => {
  // A broken workspace manifest must not fail the lanes job, which would skip every gated job.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lanes-broken-'))
  const eventPath = path.join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify(EVENT))
  const output = path.join(dir, 'output')
  const plan = await main({
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'token',
      GITHUB_OUTPUT: output,
    },
    root: dir,
    fetchImpl: async (url) =>
      url.endsWith('/pulls/7')
        ? Response.json({ head: { sha: HEAD } })
        : Response.json([]),
  })
  assert.ok(Object.values(plan).every((lane) => lane.run))
  assert.match(plan.maestro.reason, /could not be computed/)
  const written = JSON.parse(readFileSync(output, 'utf8').match(/^plan=(.*)$/m)[1])
  assert.ok(Object.values(written).every(Boolean))
})
