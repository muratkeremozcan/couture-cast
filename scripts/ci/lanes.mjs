#!/usr/bin/env node
// Change-based lane selection for pull requests. A push used 44 jobs and about 290 runner
// minutes whatever it changed, against the account's 20 concurrent jobs, so a docs fix queued
// behind the same Maestro, Playwright and native work as an API change. Each lane below names the
// files it builds, runs or reads; on a pull request a lane runs only when the diff touches one of
// them, and its job is skipped otherwise, with the reason in the plan job's summary. A push to
// main, the schedule, a manual run, and a pull request labelled ALL-LANES run every lane.
//
// The map errs one way only: a file no lane claims, a shared root file, a workflow, an action
// or a script runs every lane. scripts/ci/lanes.test.mjs replays real merged pull requests
// against it and checks that every repository file a test reads wakes that test's lanes.
//
// The plan job runs this file from a sparse checkout with no install, so it imports node:
// built-ins only.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ALL_LANES_LABEL = 'ALL-LANES'

/** GitHub's comparison lists at most 300 files; a diff that reaches it runs everything. */
export const COMPARE_FILES_CAP = 300

/** Workspaces by directory. Their @couture dependencies come from each package.json. */
export const WORKSPACES = {
  web: 'apps/web',
  api: 'apps/api',
  mobile: 'apps/mobile',
  'api-client': 'packages/api-client',
  config: 'packages/config',
  db: 'packages/db',
  'eslint-config': 'packages/eslint-config',
  'k6-utils': 'packages/k6-utils',
  testing: 'packages/testing',
  utils: 'packages/utils',
}

/**
 * Inputs no package.json declares. The API runs the Prisma client generated from packages/db and
 * the migrations in supabase/, and every workspace lints with packages/eslint-config.
 */
const UNDECLARED_DEPENDENCIES = {
  api: ['db', 'eslint-config'],
  web: ['eslint-config'],
  // apps/mobile's component tests import @couture/testing through the hoisted root install.
  mobile: ['eslint-config', 'testing'],
}

/**
 * Text no lane builds, runs or reads, unless a lane lists it by name (DOC_INPUTS). Lint still
 * formats it and the secret scan still reads it; both run on every pull request. Other Markdown
 * inside a workspace stays an input of it: API tests read policy and fixture Markdown.
 */
export const DOCS = [
  'docs/**',
  '_bmad-output/**',
  '*.md',
  '**/README.md',
  // Fixture corpora keep their own README files, which the API's corpus specs read.
  '!**/test/fixtures/**',
  // The share-card lane's iPad evidence gate (scripts/lib/story69-ipad-evidence.mjs) reads
  // this record and its screenshots.
  '!_bmad-output/test-artifacts/story-6-9/**',
  '**/CHANGELOG.md',
  'LICENSE',
]

/** Files under DOCS that a lane's tests read; each wakes the lanes named. */
export const DOC_INPUTS = {
  // apps/api/integration/community-worker-release-gate.spec.ts, moderation-history-gate.spec.ts
  // and moderation-sla-operations.spec.ts assert on these runbooks and records.
  '_bmad-output/project-knowledge/deployment-guide.md': ['coverage-api'],
  '_bmad-output/project-knowledge/couturecast_roadmap.md': ['coverage-api'],
  '_bmad-output/project-knowledge/moderation-sla-runbook.md': ['coverage-api'],
  '_bmad-output/test-artifacts/community-beta-gate-signatures.md': ['coverage-api'],
  '_bmad-output/test-artifacts/community-content-screening-model-readiness.json': [
    'coverage-api',
  ],
  'infra/grafana/dashboards/README.md': ['coverage-api'],
}

/**
 * Paths every lane reads: workflows, actions, CI scripts, root configuration, the lockfile and
 * the Node version. Matching one runs everything.
 */
export const SHARED = [
  '.github/**',
  'scripts/**',
  'tools/**',
  'infra/**',
  '_bmad/**',
  // Any root file that is not text: package.json, package-lock.json, tsconfig.json, turbo.json,
  // app.json, playwright.config.ts, lighthouserc.cjs, lint-staged.config.mjs and the dotfiles.
  '*',
]

const SUPABASE = 'supabase/**'

/**
 * Mobile files the web and package suites read: apps/web's share-card locale spec reads the
 * mobile locales, and packages/api-client's analytics-routes.spec.ts reads the mobile routes and
 * sources. Every lane that runs those suites lists them.
 */
const MOBILE_READ_BY_WEB_AND_PACKAGE_TESTS = [
  'apps/mobile/assets/locales/**',
  'apps/mobile/app/**',
  'apps/mobile/src/**',
  'apps/mobile/components/**',
]

/**
 * Paths a path-filtered workflow owns (k6-smoke-prs.yml runs k6/** itself), so they wake only
 * typecheck here.
 */
export const OWNED_BY_PATH_FILTERS = ['k6/**']

/**
 * The lanes. `workflow` and `jobs` name what each one gates; `inputs` are globs, a leading `!`
 * removing what an earlier glob added, as in GitHub's own path filters; `workspaces` adds those
 * workspaces and everything they depend on.
 */
export const LANES = {
  typecheck: {
    title: 'Typecheck workspaces',
    workflow: 'pr-checks.yml',
    jobs: ['typecheck'],
    // classify() adds it whenever a file wakes any other lane.
  },
  lighthouse: {
    title: 'Lighthouse accessibility',
    workflow: 'pr-checks.yml',
    jobs: ['lighthouse'],
    // test:a11y:lighthouse runs prepare:playwright (Prisma client, config, utils, api-client,
    // testing) before it builds and starts the web app.
    workspaces: ['web', 'config', 'utils', 'api-client', 'testing', 'db'],
  },
  'coverage-api': {
    title: 'Workspace coverage (api)',
    workflow: 'pr-checks.yml',
    jobs: ['tests-shard'],
    workspaces: ['api'],
    // API integration specs import the Playwright advisory lock and E2E config, read the web
    // project's vercel.json and assert on a Maestro flow; vercel-storage.spec.ts copies every
    // workspace manifest into the repositories it decides previews for.
    inputs: [
      SUPABASE,
      'playwright/support/**',
      'playwright/config/**',
      'apps/web/vercel.json',
      'maestro/community-feed.yaml',
      'apps/*/package.json',
      'packages/*/package.json',
    ],
  },
  'coverage-mobile': {
    title: 'Workspace coverage (mobile)',
    workflow: 'pr-checks.yml',
    jobs: ['tests-shard'],
    workspaces: ['mobile'],
    // The locale parity specs import the web and share-card render catalogs.
    inputs: [
      'apps/web/src/i18n/locales/**',
      'apps/api/src/modules/share-cards/assets/**',
    ],
  },
  'coverage-other': {
    title: 'Workspace coverage (other)',
    workflow: 'pr-checks.yml',
    jobs: ['tests-shard'],
    // scripts/ci/coverage-shards.mjs: every workspace other than apps/api and apps/mobile.
    // packages/db's RLS specs import API source, so the API is an input too.
    workspaces: [
      'web',
      'api-client',
      'config',
      'db',
      'eslint-config',
      'k6-utils',
      'testing',
      'utils',
      'api',
    ],
    // packages/db's community storage seed reads its ports from supabase/config.toml.
    inputs: [...MOBILE_READ_BY_WEB_AND_PACKAGE_TESTS, SUPABASE],
  },
  'year-ahead': {
    title: 'Unit tests a year ahead',
    workflow: 'pr-checks.yml',
    jobs: ['unit-tests-year-ahead'],
    workspaces: ['api', 'web', 'config', 'utils', 'api-client', 'testing'],
    // It reruns the web and package suites, which read these mobile files.
    inputs: MOBILE_READ_BY_WEB_AND_PACKAGE_TESTS,
  },
  community: {
    title: 'Community realtime and append latency budgets and screening gates',
    workflow: 'pr-checks.yml',
    jobs: [
      'community-realtime-budget',
      'community-append-latency',
      'community-screening-gates',
    ],
    workspaces: ['api'],
    inputs: [SUPABASE],
  },
  contract: {
    title: 'Local schema and Pact contracts',
    workflow: 'contract-testing.yml',
    jobs: ['local-contracts'],
    workspaces: ['api'],
    inputs: [SUPABASE, 'pact/**'],
  },
  'web-e2e': {
    title: 'Playwright end-to-end (local)',
    workflow: 'pr-pw-e2e-local.yml',
    jobs: ['pw-e2e', 'real-session-e2e', 'complimentary-access-e2e'],
    workspaces: ['web', 'api'],
    inputs: [SUPABASE, 'playwright/**'],
  },
  preview: {
    title: 'Vercel preview deploys and end-to-end',
    workflow: 'pr-pw-e2e-vercel-preview.yml',
    jobs: ['preview-ready', 'pw-e2e'],
    workspaces: ['web', 'api'],
    inputs: [SUPABASE, 'playwright/**'],
  },
  'playwright-unit': {
    title: 'Playwright helper unit tests',
    workflow: 'pr-checks.yml',
    jobs: ['playwright-unit'],
    // `test:playwright-unit` (vitest over playwright/support/helpers). The helpers' specs pin
    // workflows, Maestro flows and mobile sources as well as the helpers themselves.
    // Its pretest hook verifies the community screening corpus, which
    // probe-community-preview.spec.ts reads too; playwright/config/environments.ts imports
    // apps/web/git-metadata.ts.
    workspaces: ['utils', 'api-client', 'config', 'testing', 'db', 'mobile'],
    inputs: [
      SUPABASE,
      'playwright/**',
      'maestro/**',
      'apps/api/test/fixtures/community-moderation/**',
      'apps/web/git-metadata.ts',
    ],
  },
  maestro: {
    title: 'Mobile end-to-end (Maestro)',
    workflow: 'pr-mobile-e2e.yml',
    jobs: ['mobile-e2e-android'],
    // The journeys run the app against the real backend: the job starts local Supabase, resets
    // the database (migrations and seed), starts the API with its workers, and Metro
    // (scripts/run-maestro.mjs). A backend change can break a screen the flows check.
    workspaces: ['mobile', 'api'],
    inputs: [SUPABASE, 'maestro/**'],
  },
  'share-card': {
    title: 'Share-card browser acceptance',
    workflow: 'pr-share-card-native.yml',
    jobs: ['browser-acceptance'],
    // The lane starts the web app, the API and Postgres and drives the share card in three
    // browsers; scripts/** (every CI script test runs here) is in SHARED.
    workspaces: ['web', 'api', 'mobile'],
    inputs: [
      SUPABASE,
      'maestro/**',
      'playwright/share-card.config.ts',
      'playwright/tests/share-card-*.spec.ts',
      'playwright/support/**',
      '_bmad-output/test-artifacts/story-6-9/**',
    ],
  },
  'revenuecat-bundle': {
    title: 'RevenueCat Test Store key bundle scan',
    workflow: 'pr-checks.yml',
    jobs: ['revenuecat-bundle-scan'],
    // The scan exports and searches the whole app, so any file the export bundles is an input:
    // a new source can read the key outside __DEV__ or carry a test_ literal.
    workspaces: ['mobile'],
  },
  // The one macOS job a pull request may run (story 6.15 D6) holds two lanes, each gating its
  // own steps: the job runs when either lane does.
  'ios-unit': {
    title: 'iOS module unit tests (Linux rules, macOS glue)',
    workflow: 'pr-apple-native.yml',
    jobs: ['apple-native', 'swift-linux'],
    // The Swift packages and the XCTest target build from these directories alone.
    inputs: [
      'apps/mobile/modules/share-card-native-share/ios/**',
      'apps/mobile/modules/share-card-photo-save/ios/**',
      'apps/mobile/modules/accessibility-focus/ios/**',
      // The header semantics controls (scripts/ci/share-card-header-semantics.sh).
      'apps/mobile/native-tests/ShareCardHeaderSemantics.swift',
    ],
  },
  'ios-flow-syntax': {
    title: 'iOS Maestro flow syntax (Linux)',
    workflow: 'pr-apple-native.yml',
    jobs: ['ios-flow-syntax'],
    // The flows scripts/ci/maestro-check-flows.mjs checks.
    inputs: ['maestro/story65/**', 'maestro/story67/**', 'maestro/story68/**'],
  },
  watchos: {
    title: 'watchOS native (macOS)',
    workflow: 'pr-apple-native.yml',
    jobs: ['apple-native'],
    // What the watchOS suite copies into its prebuild fixture (plugins/prebuild-test-helpers.js),
    // the watch Swift sources under targets included; the Expo tooling it runs comes from the root
    // install, which SHARED covers. JavaScript and package changes wake no macOS job.
    inputs: [
      'apps/mobile/app.json',
      'apps/mobile/package.json',
      'apps/mobile/plugins/**',
      'apps/mobile/targets/**',
      'apps/mobile/assets/**',
    ],
  },
}

/** A glob as a RegExp: `**` spans directories, `*` and `?` stay within one, dotfiles match. */
export function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/'
      source += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

const compiled = new Map()
function matches(file, glob) {
  if (!compiled.has(glob)) compiled.set(glob, globToRegExp(glob))
  return compiled.get(glob).test(file)
}

/** GitHub's path filter rule: the last glob that matches decides, and a `!` glob excludes. */
export function matchesAny(file, globs) {
  let included = false
  for (const glob of globs) {
    const negated = glob.startsWith('!')
    if (matches(file, negated ? glob.slice(1) : glob)) included = !negated
  }
  return included
}

/** Each workspace's @couture dependencies, from the package.json files under `root`. */
export function readWorkspaceDependencies(root) {
  const byPackageName = {}
  const manifests = {}
  for (const [name, dir] of Object.entries(WORKSPACES)) {
    const manifest = JSON.parse(
      readFileSync(path.join(root, dir, 'package.json'), 'utf8')
    )
    manifests[name] = manifest
    byPackageName[manifest.name] = name
  }
  const dependencies = {}
  for (const [name, manifest] of Object.entries(manifests)) {
    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    })
      .map((dependency) => byPackageName[dependency])
      .filter(Boolean)
    dependencies[name] = [
      ...new Set([...declared, ...(UNDECLARED_DEPENDENCIES[name] ?? [])]),
    ]
  }
  return dependencies
}

/** A workspace and every workspace it reaches through its dependencies. */
function closure(names, dependencies) {
  const seen = new Set()
  const visit = (name) => {
    if (seen.has(name)) return
    if (!(name in WORKSPACES)) throw new Error(`Unknown workspace ${name}`)
    seen.add(name)
    for (const dependency of dependencies[name] ?? []) visit(dependency)
  }
  names.forEach(visit)
  return [...seen]
}

/** Each lane's input globs, with its workspaces expanded. */
export function laneInputs(dependencies) {
  return Object.fromEntries(
    Object.entries(LANES).map(([id, lane]) => [
      id,
      [
        ...closure(lane.workspaces ?? [], dependencies).map(
          (name) => `${WORKSPACES[name]}/**`
        ),
        ...(lane.inputs ?? []),
      ],
    ])
  )
}

/**
 * What one file wakes: `shared` (every lane), `docs` (none), or the lanes whose inputs match.
 * A file that no lane claims and that is not text runs every lane too.
 */
export function classify(file, inputs) {
  if (file in DOC_INPUTS) return { kind: 'lanes', lanes: DOC_INPUTS[file] }
  if (matchesAny(file, DOCS)) return { kind: 'docs', lanes: [] }
  if (matchesAny(file, SHARED)) return { kind: 'shared', lanes: Object.keys(LANES) }
  if (matchesAny(file, OWNED_BY_PATH_FILTERS))
    return { kind: 'lanes', lanes: ['typecheck'] }
  const lanes = Object.keys(LANES).filter(
    (id) => id !== 'typecheck' && matchesAny(file, inputs[id])
  )
  if (lanes.length === 0) return { kind: 'unclaimed', lanes: Object.keys(LANES) }
  return { kind: 'lanes', lanes: ['typecheck', ...lanes] }
}

const list = (files) =>
  files.length <= 3
    ? files.join(', ')
    : `${files.slice(0, 3).join(', ')} and ${files.length - 3} more`

/**
 * The plan: for each lane, whether it runs and why.
 * @param {{ event: string, files?: string[] | null, labels?: string[], dependencies: Record<string, string[]> }} options
 *   `files` is the pull request's changed files, old paths of renames included; null when they
 *   could not be read.
 */
export function selectLanes({ event, files, labels = [], dependencies }) {
  const everything = (reason) =>
    Object.fromEntries(Object.keys(LANES).map((id) => [id, { run: true, reason }]))
  if (event !== 'pull_request') return everything(`a ${event} event runs every lane`)
  if (labels.includes(ALL_LANES_LABEL))
    return everything(`the ${ALL_LANES_LABEL} label runs every lane`)
  if (!files) return everything('the changed files could not be read, so every lane runs')
  if (files.length >= COMPARE_FILES_CAP)
    return everything(
      `the diff reaches the comparison's ${COMPARE_FILES_CAP}-file limit, so every lane runs`
    )

  const inputs = laneInputs(dependencies)
  const woken = Object.fromEntries(Object.keys(LANES).map((id) => [id, []]))
  const forEveryLane = []
  for (const file of files) {
    const { kind, lanes } = classify(file, inputs)
    if (kind === 'shared' || kind === 'unclaimed') forEveryLane.push(file)
    for (const id of lanes) woken[id].push(file)
  }
  const plan = {}
  for (const id of Object.keys(LANES)) {
    if (forEveryLane.length > 0)
      plan[id] = {
        run: true,
        reason: `${list(forEveryLane)} changed, which every lane reads`,
      }
    else if (woken[id].length > 0)
      plan[id] = { run: true, reason: `${list(woken[id])} changed` }
    else
      plan[id] = {
        run: false,
        reason:
          files.length === 0
            ? 'the pull request changes no files'
            : 'no file this lane builds, runs or reads changed',
      }
  }
  return plan
}

/**
 * The files changed between the event's base and head commits, old paths of renames included.
 * Both commits are fixed in the event, so a rerun or a push during the read cannot hand the plan
 * another commit's files, as the pull request's own files endpoint, which answers for its head
 * now, can. Renames count both paths, so a list at COMPARE_FILES_CAP may be cut short; the plan
 * runs every lane then.
 */
async function changedFiles({ repository, base, head, token, fetchImpl = fetch }) {
  const commit = /^[0-9a-f]{40}$/
  if (!commit.test(base ?? '') || !commit.test(head ?? ''))
    throw new Error('the event names no base and head commit')
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/compare/${base}...${head}?per_page=1`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    }
  )
  if (!response.ok) throw new Error(`GET the comparison answered ${response.status}`)
  const { files: entries } = await response.json()
  if (!Array.isArray(entries)) throw new Error('the comparison lists no files')
  return entries.flatMap((entry) =>
    entry.previous_filename ? [entry.filename, entry.previous_filename] : [entry.filename]
  )
}

/** Every lane runs, for the reason given. */
const everyLane = (reason) =>
  Object.fromEntries(Object.keys(LANES).map((id) => [id, { run: true, reason }]))

/** The labels on the pull request now, every page, so a rerun after adding ALL-LANES sees it. */
async function pullRequestLabels({ repository, number, token, fetchImpl = fetch }) {
  const labels = []
  for (let page = 1; ; page++) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/issues/${number}/labels?per_page=100&page=${page}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(30_000),
      }
    )
    if (!response.ok)
      throw new Error(`GET pull request labels answered ${response.status}`)
    const batch = await response.json()
    labels.push(...batch.map((label) => label.name))
    if (batch.length < 100) return labels
  }
}

/** The plan as a Markdown table for the job summary. */
export function summary(plan, { workflow } = {}) {
  const rows = Object.entries(plan)
    .filter(([id]) => !workflow || LANES[id].workflow === workflow)
    .map(
      ([id, { run, reason }]) =>
        `| ${LANES[id].title} | ${LANES[id].workflow} | ${run ? 'runs' : 'skipped'} | ${reason.replaceAll('|', '\\|')} |`
    )
  return [
    '### Lanes',
    '',
    '| Lane | Workflow | Result | Why |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

/** The coverage shards (scripts/ci/coverage-shards.mjs) whose lane runs, in matrix order. */
export function coverageShards(plan) {
  return ['api', 'mobile', 'other'].filter((shard) => plan[`coverage-${shard}`].run)
}

/**
 * The job outputs: `plan`, a JSON object of lane id to true or false that jobs read with
 * `fromJSON(needs.lanes.outputs.plan)['<lane>']`, and `coverage_shards`, the JSON array the
 * coverage matrix runs.
 */
export function outputLines(plan) {
  const runs = Object.fromEntries(Object.entries(plan).map(([id, { run }]) => [id, run]))
  return `plan=${JSON.stringify(runs)}\ncoverage_shards=${JSON.stringify(coverageShards(plan))}\n`
}

/** The plan job: reads the event and writes the outputs and the summary. */
export async function main({ env = process.env, root = process.cwd(), fetchImpl } = {}) {
  const event = env.GITHUB_EVENT_NAME
  const payload = env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    : {}
  const pullRequest = payload.pull_request
  let files = null
  let labels = []
  if (event === 'pull_request') {
    try {
      const request = {
        repository: env.GITHUB_REPOSITORY,
        number: pullRequest?.number,
        token: env.GITHUB_TOKEN,
        fetchImpl,
      }
      const [changed, current] = await Promise.all([
        changedFiles({
          ...request,
          base: pullRequest?.base?.sha,
          head: pullRequest?.head?.sha,
        }),
        pullRequestLabels(request),
      ])
      files = changed
      labels = current
    } catch (error) {
      files = null
      console.log(
        `::warning::Could not read the pull request's changes, so every lane runs: ${error.message}`
      )
    }
  }
  let plan
  try {
    plan = selectLanes({
      event,
      files,
      labels,
      dependencies: readWorkspaceDependencies(root),
    })
  } catch (error) {
    // A failed lanes job skips every job that needs it; running everything is the safe plan.
    console.log(`::warning::The lane plan failed, so every lane runs: ${error.message}`)
    plan = everyLane(`the lane plan could not be computed (${error.message})`)
  }
  const workflow = env.LANES_WORKFLOW || undefined
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, outputLines(plan))
  const table = summary(plan, { workflow })
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, table)
  console.log(table)
  return plan
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main()
}
