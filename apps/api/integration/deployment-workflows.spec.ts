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
const mobileWorkflow = path.join(repoRoot, '.github', 'workflows', 'deploy-mobile.yml')
const vercelConfig = path.join(repoRoot, 'apps', 'api', 'vercel.json')
const apiHandler = path.join(repoRoot, 'apps', 'api', 'api', 'index.ts')
const rootPackageJson = path.join(repoRoot, 'package.json')

describe('deployment workflows', () => {
  it('vercel preview smoke workflow exists and resolves preview URLs', () => {
    expect(fs.existsSync(vercelPreviewSmokeWorkflow)).toBe(true)
    const content = fs.readFileSync(vercelPreviewSmokeWorkflow, 'utf8')
    expect(content).toMatch(/on:\s*\n\s*pull_request:/)
    expect(content).toMatch(/Resolve preview health URL/)
    expect(content).toMatch(
      /uses: \.\/\.github\/workflows\/vercel-wait-for-deployment.yml/
    )
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
})
