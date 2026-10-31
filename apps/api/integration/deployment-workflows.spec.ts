// Learning path Step 7: CI and CD automated quality gates.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-7-ci-and-cd-automated-quality-gates
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(__dirname, '../../..')

const vercelPreviewSmokeWorkflow = path.join(
  repoRoot,
  '.github',
  'workflows',
  'pr-pw-e2e-vercel-preview.yml'
)
const previewReadyWorkflow = path.join(
  repoRoot,
  '.github',
  'workflows',
  'rwf-vercel-preview-ready.yml'
)
const vercelWaitWorkflow = path.join(
  repoRoot,
  '.github',
  'workflows',
  'vercel-wait-for-deployment.yml'
)
const manualE2eWorkflow = path.join(
  repoRoot,
  '.github',
  'workflows',
  'pw-e2e-trigger.yml'
)
const prodE2eWorkflow = path.join(repoRoot, '.github', 'workflows', 'pw-e2e-prod.yml')
const e2eReusableWorkflow = path.join(repoRoot, '.github', 'workflows', 'rwf-e2e.yml')
const previewReadyCall = /uses: \.\/\.github\/workflows\/rwf-vercel-preview-ready\.yml/
const mobileWorkflow = path.join(repoRoot, '.github', 'workflows', 'deploy-mobile.yml')
const vercelConfig = path.join(repoRoot, 'apps', 'api', 'vercel.json')
const apiHandler = path.join(repoRoot, 'apps', 'api', 'api', 'index.ts')
const apiPackageJson = path.join(repoRoot, 'apps', 'api', 'package.json')
const rootPackageJson = path.join(repoRoot, 'package.json')
const startLocalSupabaseAction = path.join(
  repoRoot,
  '.github',
  'actions',
  'start-local-supabase',
  'action.yml'
)
const reserveSupabasePortsAction = path.join(
  repoRoot,
  '.github',
  'actions',
  'reserve-supabase-ports',
  'action.yml'
)
const startLocalSupabaseUse = 'uses: ./.github/actions/start-local-supabase'
const reservePortsUse = 'uses: ./.github/actions/reserve-supabase-ports'

/**
 * Each job's steps in order, as the raw text of each `- ` step entry. A job whose
 * `steps:` key is a YAML anchor (`&name`) or alias (`*name`) gets the anchored list, so
 * jobs that reuse one step list are checked like any other.
 */
function jobSteps(workflow: string): Map<string, string[]> {
  const jobs = new Map<string, string[]>()
  const anchored = new Map<string, string[]>()
  const aliases: [string, string][] = []
  const body = workflow.slice(workflow.search(/^jobs:\s*$/m))
  for (const block of body.split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m).slice(1)) {
    const name = block.slice(2, block.indexOf(':'))
    const header = /^ {4}steps:(?: ([&*])([A-Za-z0-9_-]+))?\s*$/m.exec(block)
    if (!header) continue
    if (header[1] === '*') {
      aliases.push([name, header[2] as string])
      continue
    }
    const steps = block
      .slice(header.index)
      .split(/^ {6}- /m)
      .slice(1)
    jobs.set(name, steps)
    if (header[1] === '&') anchored.set(header[2] as string, steps)
  }
  for (const [name, anchor] of aliases) {
    const steps = anchored.get(anchor)
    expect(steps, `${name} aliases an unknown steps anchor ${anchor}`).toBeDefined()
    jobs.set(name, steps as string[])
  }
  return jobs
}

describe('deployment workflows', () => {
  it('vercel preview smoke workflow exists and resolves preview URLs', () => {
    expect(fs.existsSync(vercelPreviewSmokeWorkflow)).toBe(true)
    const content = fs.readFileSync(vercelPreviewSmokeWorkflow, 'utf8')
    expect(content).toMatch(/on:\s*\n\s*pull_request:/)
    expect(content).toMatch(previewReadyCall)

    const ready = fs.readFileSync(previewReadyWorkflow, 'utf8')
    expect(ready).toMatch(/Resolve preview health URL/)
    // Web and API are each waited on before any caller tests them.
    expect(
      ready.match(/uses: \.\/\.github\/workflows\/vercel-wait-for-deployment\.yml/g)
    ).toHaveLength(2)
  })

  it('the web preview wait outlasts the slowest observed web build', () => {
    const ready = fs.readFileSync(previewReadyWorkflow, 'utf8')
    const wait = fs.readFileSync(vercelWaitWorkflow, 'utf8')
    const webCall = /wait-web:[\s\S]*?retries: (\d+)\s+sleep_seconds: (\d+)/.exec(ready)
    expect(webCall).not.toBeNull()
    const budgetSeconds = Number(webCall?.[1]) * Number(webCall?.[2])
    // Run 40728198560: the web build outlived 20 x 30s (10 minutes) by seconds.
    expect(budgetSeconds).toBeGreaterThanOrEqual(1200)
    // A hung connection must not stall an attempt: every fetch carries a hard limit.
    const fetchLimit = Number(/curl -sS -L --max-time (\d+) /.exec(wait)?.[1])
    expect(fetchLimit).toBeGreaterThan(0)
    expect(fetchLimit).toBeLessThanOrEqual(30)
    // Worst case every attempt hangs to its fetch limit, plus the final verification fetch.
    const sleep = Number(webCall?.[2])
    const worstCaseSeconds = Number(webCall?.[1]) * (sleep + fetchLimit) + fetchLimit
    const limitMinutes = Number(/timeout-minutes: (\d+)/.exec(wait)?.[1])
    expect(limitMinutes * 60).toBeGreaterThanOrEqual(worstCaseSeconds)
  })

  it('the wait fetch uses a hard time limit so a hung connection cannot stall polling', () => {
    const wait = fs.readFileSync(vercelWaitWorkflow, 'utf8')
    const fetches = wait.match(/^\s*curl .*$/gm) ?? []
    expect(fetches).toHaveLength(1)
    expect(fetches[0]).toMatch(/--max-time \d+/)
  })

  it('the wait step names the HTML page it received and the elapsed time per attempt', () => {
    const wait = fs.readFileSync(vercelWaitWorkflow, 'utf8')
    const script = /run: \|\n((?: {10}.*\n|\n)+)/.exec(wait)?.[1]?.replace(/^ {10}/gm, '')
    expect(script).toBeDefined()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-wait-'))
    try {
      fs.writeFileSync(
        path.join(directory, 'curl'),
        "#!/bin/bash\nprintf '<!DOCTYPE html><html><head><title>Login - Vercel</title></head></html>\\n__STATUS__:200'\n",
        { mode: 0o700 }
      )
      const run = spawnSync('/bin/bash', ['-e', '-c', script as string], {
        encoding: 'utf8',
        env: {
          PATH: `${directory}:${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: path.join(directory, 'out'),
          HEALTH_URL: 'https://preview.invalid/api/health',
          EXPECTED_SHA: 'a'.repeat(40),
          RETRIES: '2',
          SLEEP_SECONDS: '0',
          VERCEL_BYPASS_SECRET: 'unit-test-value',
        },
      })
      expect(run.status).toBe(1)
      expect(run.stdout).toMatch(
        /Response is not valid JSON \(attempt 1\/2, http=200, elapsed=\d+s\)/
      )
      expect(run.stdout).toMatch(
        /Response is not valid JSON \(attempt 2\/2, http=200, elapsed=\d+s\)/
      )
      expect(run.stdout).toContain("HTML page title: 'Login - Vercel'")
      expect(run.stdout).toMatch(
        /failed to become healthy after waiting \(elapsed=\d+s, last page title: 'Login/
      )
      expect(run.stdout).not.toContain('unit-test-value')
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('manual preview e2e runs only after both previews serve the dispatched commit', () => {
    const content = fs.readFileSync(manualE2eWorkflow, 'utf8')
    expect(content).toMatch(previewReadyCall)
    // The ordering is the fix: tests used to start against still-building deployments.
    expect(content).toMatch(/run-preview-tests:\s*\n\s*needs: preview-ready/)
    expect(content).toMatch(/needs\.preview-ready\.outputs\.api_url/)
  })

  it('e2e workflows request no OIDC token', () => {
    // Nothing consumes one, and a reusable job that requests it fails at
    // startup under any caller that does not grant it.
    for (const workflow of [
      e2eReusableWorkflow,
      vercelPreviewSmokeWorkflow,
      manualE2eWorkflow,
      prodE2eWorkflow,
    ]) {
      expect(fs.readFileSync(workflow, 'utf8')).not.toMatch(/id-token:/)
    }
  })

  it('prod e2e waits for web and API to serve the pushed commit', () => {
    const content = fs.readFileSync(prodE2eWorkflow, 'utf8')
    expect(content).toMatch(
      /health_url: https:\/\/couture-cast-web\.vercel\.app\/api\/health/
    )
    expect(content).toMatch(
      /health_url: https:\/\/couture-cast-api\.vercel\.app\/api\/health/
    )
    expect(content).toMatch(/needs: \[wait-web, wait-api\]/)
    // /api/v1/events/poll needs a bearer token, so waiting for 200 on it never ends.
    expect(content).not.toMatch(/_url: \S*events\/poll/)
  })

  it('prod e2e lets the newer main push supersede a run still testing the older one', () => {
    // A group keyed by run_id never matches another run, so two pushes minutes
    // apart overlapped and the older run's web-health-sha read the newer SHA.
    const content = fs.readFileSync(prodE2eWorkflow, 'utf8')
    expect(content).toMatch(
      /^concurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true$/m
    )
    expect(content).not.toMatch(/github\.run_id/)
  })

  it('mobile workflow exists and deploys manually with Expo token (Android-only)', () => {
    expect(fs.existsSync(mobileWorkflow)).toBe(true)
    const content = fs.readFileSync(mobileWorkflow, 'utf8')
    // Manual trigger only (workflow_dispatch); no push trigger.
    expect(content).toMatch(/workflow_dispatch/)
    expect(content).toMatch(/EXPO_TOKEN/)
    expect(content).toMatch(/platform android/)
    expect(content).toMatch(/eas build/)
  })

  it('vercel config exists for unified web/api deploy', () => {
    expect(fs.existsSync(vercelConfig)).toBe(true)
    const content = fs.readFileSync(vercelConfig, 'utf8')
    const json = JSON.parse(content) as {
      version?: number
      functions?: Record<string, { runtime?: string }>
    }

    expect(json.version).toBe(2)
    expect(json.functions).toBeDefined()
    expect(json.functions?.['api/index.ts']?.runtime).toBeUndefined()
  })

  it('api handler exists and prepare is CI-safe', () => {
    expect(fs.existsSync(apiHandler)).toBe(true)
    const pkg = JSON.parse(fs.readFileSync(rootPackageJson, 'utf8')) as {
      scripts?: { prepare?: string }
    }
    expect(pkg.scripts?.prepare).toBe('node .husky/install.mjs')
  })

  it('every job that starts local Supabase uses the shared action', () => {
    const workflowsDir = path.join(repoRoot, '.github', 'workflows')
    const callers: string[] = []
    for (const file of fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml'))) {
      const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8')
      // A direct start would skip the image cache, the port guard and the retries.
      expect(content, file).not.toMatch(/^\s*(run:\s*)?npx supabase start/m)
      if (content.includes(startLocalSupabaseUse)) {
        callers.push(file)
      }
    }
    expect(callers.sort()).toEqual([
      'k6-smoke-prs.yml',
      'pr-mobile-e2e.yml',
      'pr-pw-e2e-local.yml',
      'pr-share-card-native.yml',
      'rwf-burn-in.yml',
      'rwf-e2e.yml',
    ])
  })

  it('every job that starts local Supabase reserves its ports right after checkout', () => {
    const workflowsDir = path.join(repoRoot, '.github', 'workflows')
    let startingJobs = 0
    for (const file of fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml'))) {
      const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8')
      for (const [job, steps] of jobSteps(content)) {
        const start = steps.findIndex((step) => step.includes(startLocalSupabaseUse))
        if (start === -1) continue
        startingJobs += 1
        const checkout = steps.findIndex((step) =>
          step.includes('uses: actions/checkout@')
        )
        const reserve = steps.findIndex((step) => step.includes(reservePortsUse))
        // A local action needs the checkout; every later step adds network
        // traffic that could take a Supabase port as its local port.
        expect(checkout, `${file} ${job}`).toBe(0)
        expect(reserve, `${file} ${job}`).toBe(checkout + 1)
        expect(reserve, `${file} ${job}`).toBeLessThan(start)
      }
    }
    // pr-share-card-native.yml starts it in six jobs: the API32 original-resource job, the
    // browser lane and the four Android 36 partitions (three of them reuse the first one's
    // anchored steps). The iOS shards start Supabase from scripts/ci/native-supabase.mjs.
    expect(startingJobs).toBe(12)
  })

  it('the share-card native workflow runs only the browser lane on pull requests', () => {
    const content = fs.readFileSync(
      path.join(repoRoot, '.github', 'workflows', 'pr-share-card-native.yml'),
      'utf8'
    )
    expect(content).toMatch(/on:\s*\n\s*pull_request:/)
    expect(content).toMatch(/schedule:\s*\n\s*- cron: '[^']+'/)
    const body = content.slice(content.search(/^jobs:\s*$/m))
    const jobs = body.split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m).slice(1)
    const ifOf = (block: string) => /^ {4}if: (.+)$/m.exec(block)?.[1]
    const skipped = new Set<string>()
    for (const block of jobs) {
      const name = block.slice(2, block.indexOf(':'))
      const condition = ifOf(block)
      if (condition?.includes("github.event_name != 'pull_request'")) skipped.add(name)
      else expect(['browser-acceptance', 'share-card-lanes-gate'], name).toContain(name)
    }
    // The device lanes take over an hour each, and the evidence jobs only read their artifacts;
    // a pull request would wait on all of them.
    expect([...skipped].sort()).toEqual([
      'android36-controls',
      'android36-interaction',
      'android36-matrix-evidence',
      'android36-native-matrix',
      'android36-original',
      'ios-build',
      'ios-evidence',
      'ios-expo-go',
      'ios-shard',
      'original-resource',
      'original-resource-evidence',
    ])
  })

  it('local Supabase starts from the image cache with its host ports guarded', () => {
    const content = fs.readFileSync(startLocalSupabaseAction, 'utf8')
    const reserve = fs.readFileSync(reserveSupabasePortsAction, 'utf8')
    const at = (needle: string) => {
      const index = content.indexOf(needle)
      expect(index, needle).toBeGreaterThan(-1)
      return index
    }

    // Images restore and load before the start; the registry pull is the fallback.
    expect(at('uses: actions/cache/restore@v4')).toBeLessThan(
      at('name: Load the cached Supabase images')
    )
    expect(at('name: Load the cached Supabase images')).toBeLessThan(
      at('name: Start local Supabase with retry')
    )
    expect(content).toMatch(/registries\+=\("\$CACHED_REGISTRY"\)/)

    // The ports sit in the ephemeral range. Reserving them steers new
    // connections away; the action's own first step repeats it for any caller.
    expect(reserve).toMatch(/net\.ipv4\.ip_local_reserved_ports=/)
    // The write is verified by reading the sysctl back, ranges included, and
    // every way the reservation can fail on Linux stops the job, named.
    const write = reserve.indexOf('sudo -n sysctl -q -w')
    const readBack = reserve.indexOf(
      'mapfile -t missing < <(uncovered_ports "$reserved")',
      write
    )
    expect(write).toBeGreaterThan(-1)
    expect(readBack).toBeGreaterThan(write)
    expect(reserve).toMatch(/entry%-\*/)
    for (const failure of [
      /::error::sysctl could not reserve the Supabase host ports[^\n]*"\n\s+exit 1/,
      /::error::net\.ipv4\.ip_local_reserved_ports reads back as[^\n]*"\n\s+exit 1/,
      /::error::Reserving the Supabase host ports needs passwordless sudo[^\n]*"\n\s+exit 1/,
    ]) {
      expect(reserve).toMatch(failure)
    }
    expect(reserve).not.toMatch(/::warning::/)
    expect(at(reservePortsUse)).toBeLessThan(
      at('name: Compute the Supabase image cache key')
    )

    // A socket already on a port is never closed by this action: each attempt
    // waits for it to go and, when it stays, fails that attempt naming it.
    expect(at('! wait_for_free_ports; then ports_free=false; fi')).toBeLessThan(
      at('run_start "$remaining" 2>&1 | tee "$attempt_log"')
    )
    expect(content).toMatch(/::error::Supabase host ports are still in use after/)
    expect(content).toMatch(/held by \$\{owners/)
    // Listeners and live or closing connections always block. TIME_WAIT blocks
    // only while Docker's bind (SO_REUSEADDR on 0.0.0.0) would fail on it: one
    // left by a listener that is gone does not, so the start must not wait on it.
    expect(content).toMatch(/while held="\$\(blocking_sockets\)"/)
    expect(content).toMatch(
      /ss_sockets -Htanp state all exclude time-wait "\$port_filter"/
    )
    expect(content).toMatch(/awk '\$1 == "TIME-WAIT"'/)
    expect(content).toMatch(/if \[ -n "\$on_port" \] && bind_blocked "\$port"; then/)
    expect(content).toMatch(/host: "0\.0\.0\.0"/)
    expect(content).toMatch(/ss_sockets -tanp state all "\$port_filter"/)
    expect(content).not.toMatch(/ss -ltnp/)

    // Only a failed or cut-off pull moves to another registry.
    expect(content).toMatch(/elif pull_failed "\$exit_code"; then\s+registry_index=/)
  })

  it('no workflow or action closes sockets it does not own', () => {
    const files = [
      ...fs
        .readdirSync(path.join(repoRoot, '.github', 'workflows'))
        .map((f) => path.join(repoRoot, '.github', 'workflows', f)),
      ...fs
        .readdirSync(path.join(repoRoot, '.github', 'actions'))
        .map((d) => path.join(repoRoot, '.github', 'actions', d, 'action.yml'))
        .filter((f) => fs.existsSync(f)),
    ]
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      // `ss -K` (or --kill) destroys every socket its filter matches,
      // whoever owns it.
      expect(content, file).not.toMatch(/\bss\b[^\n]*\s(-[a-zA-Z]*K|--kill)\b/)
    }
  })

  it('api vercel build applies committed Prisma migrations before building', () => {
    expect(fs.existsSync(apiPackageJson)).toBe(true)
    const pkg = JSON.parse(fs.readFileSync(apiPackageJson, 'utf8')) as {
      scripts?: { 'vercel:build'?: string }
    }

    expect(pkg.scripts?.['vercel:build']).toContain(
      'node scripts/prisma-migrate-deploy.mjs'
    )
  })
})
