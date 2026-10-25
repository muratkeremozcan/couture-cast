// Learning path Step 7: CI and CD automated quality gates.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-7-ci-and-cd-automated-quality-gates
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

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

/** Each job's steps in order, as the raw text of each `- ` step entry. */
function jobSteps(workflow: string): Map<string, string[]> {
  const jobs = new Map<string, string[]>()
  const body = workflow.slice(workflow.search(/^jobs:\s*$/m))
  for (const block of body.split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m).slice(1)) {
    const name = block.slice(2, block.indexOf(':'))
    const stepsAt = block.search(/^ {4}steps:\s*$/m)
    if (stepsAt === -1) continue
    jobs.set(
      name,
      block
        .slice(stepsAt)
        .split(/^ {6}- /m)
        .slice(1)
    )
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
    expect(startingJobs).toBe(6)
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
