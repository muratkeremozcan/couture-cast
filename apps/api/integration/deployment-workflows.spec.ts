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
const previewReadyCall = /uses: \.\/\.github\/workflows\/rwf-vercel-preview-ready\.yml/
const mobileWorkflow = path.join(repoRoot, '.github', 'workflows', 'deploy-mobile.yml')
const vercelConfig = path.join(repoRoot, 'apps', 'api', 'vercel.json')
const apiHandler = path.join(repoRoot, 'apps', 'api', 'api', 'index.ts')
const apiPackageJson = path.join(repoRoot, 'apps', 'api', 'package.json')
const rootPackageJson = path.join(repoRoot, 'package.json')

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

  it('manual preview e2e waits for both previews and can mint an OIDC token', () => {
    const content = fs.readFileSync(manualE2eWorkflow, 'utf8')
    // rwf-e2e.yml requests id-token: write; a caller without it fails at startup.
    expect(content).toMatch(/permissions:\s*\n\s*contents: read\s*\n\s*id-token: write/)
    expect(content).toMatch(previewReadyCall)
    expect(content).toMatch(
      /custom_api_base_url: \$\{\{ needs\.preview-ready\.outputs\.api_url \}\}/
    )
  })

  it('prod e2e waits on public health endpoints only', () => {
    const content = fs.readFileSync(prodE2eWorkflow, 'utf8')
    expect(content).toMatch(
      /secondary_url: https:\/\/couture-cast-api\.vercel\.app\/api\/health/
    )
    // /api/v1/events/poll needs a bearer token, so waiting for 200 on it never ends.
    expect(content).not.toMatch(/secondary_url: \S*events\/poll/)
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
