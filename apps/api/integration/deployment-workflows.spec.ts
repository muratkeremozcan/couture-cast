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
      if (content.includes('uses: ./.github/actions/start-local-supabase')) {
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

  it('local Supabase starts from the image cache with its host ports guarded', () => {
    const content = fs.readFileSync(startLocalSupabaseAction, 'utf8')
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

    // The Supabase ports sit in the ephemeral range: they are reserved once and
    // any client socket on one is closed before every attempt.
    expect(content).toMatch(/net\.ipv4\.ip_local_reserved_ports=/)
    expect(content).toMatch(/ss -K -tn state connected "\$port_filter"/)
    expect(
      at('if [ "$port_guard" = true ]; then reserve_supabase_ports; fi')
    ).toBeLessThan(at('if [ "$port_guard" = true ]; then free_supabase_ports; fi'))
    expect(at('if [ "$port_guard" = true ]; then free_supabase_ports; fi')).toBeLessThan(
      at('run_start "$remaining" 2>&1 | tee "$attempt_log"')
    )
    // Listeners alone miss a client socket on the port; diagnostics show every state.
    expect(content).toMatch(/ss -tanp state all "\$port_filter"/)
    expect(content).not.toMatch(/ss -ltnp/)

    // Only a failed or cut-off pull moves to another registry.
    expect(content).toMatch(/if pull_failed "\$exit_code"; then\s+registry_index=/)
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
