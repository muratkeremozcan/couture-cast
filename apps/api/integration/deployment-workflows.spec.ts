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
  it('vercel preview smoke workflow exists and triggers on deployment_status', () => {
    expect(fs.existsSync(vercelPreviewSmokeWorkflow)).toBe(true)
    const content = fs.readFileSync(vercelPreviewSmokeWorkflow, 'utf8')
    expect(content).toMatch(/deployment_status/)
  })

  it('mobile workflow exists and deploys on main with Expo token', () => {
    expect(fs.existsSync(mobileWorkflow)).toBe(true)
    const content = fs.readFileSync(mobileWorkflow, 'utf8')
    expect(content).toMatch(/branches:\s*(\[[^\]]*main[^\]]*\]|[\s\S]*?-+\s*main)/)
    expect(content).toMatch(/EXPO_TOKEN/)
    expect(content).toMatch(/eas build/)
  })

  it('vercel config exists for unified web/api deploy', () => {
    expect(fs.existsSync(vercelConfig)).toBe(true)
    const content = fs.readFileSync(vercelConfig, 'utf8')
    expect(content).toMatch(/"functions"/)
    expect(content).toMatch(/api\/index\.ts/)
  })

  it('api handler exists and prepare is CI-safe', () => {
    expect(fs.existsSync(apiHandler)).toBe(true)
    const pkg = JSON.parse(fs.readFileSync(rootPackageJson, 'utf8')) as {
      scripts?: { prepare?: string }
    }
    expect(pkg.scripts?.prepare).toBe('node .husky/install.mjs')
  })
})
