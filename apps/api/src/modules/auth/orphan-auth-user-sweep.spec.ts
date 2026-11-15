// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA-14: the orphan Auth user sweep runs only where it is named, never in a test
// environment. The deletion rules live in integration/orphan-auth-user-sweep.integration.spec.ts.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { orphanAuthUserSweepEnabled } from './orphan-auth-user-sweep'

describe('ORPHAN_AUTH_USER_SWEEP_ENABLED is documented where the worker is configured', () => {
  const root = path.resolve(__dirname, '../../../../..')
  it.each(['.env.example', '_bmad-output/project-knowledge/deployment-guide.md'])(
    '%s names the variable and why it is gated',
    (file) => {
      const text = fs.readFileSync(path.join(root, file), 'utf8')
      expect(text).toContain('ORPHAN_AUTH_USER_SWEEP_ENABLED=true')
      expect(text).toMatch(/TEA-14/)
    }
  )
})

describe('orphanAuthUserSweepEnabled', () => {
  it('runs only with ORPHAN_AUTH_USER_SWEEP_ENABLED=true outside test environments', () => {
    expect(orphanAuthUserSweepEnabled({ ORPHAN_AUTH_USER_SWEEP_ENABLED: 'true' })).toBe(
      true
    )
  })

  it.each([
    ['unset', {}],
    ['set to 1', { ORPHAN_AUTH_USER_SWEEP_ENABLED: '1' }],
    ['set to TRUE', { ORPHAN_AUTH_USER_SWEEP_ENABLED: 'TRUE' }],
    [
      'under TEST_ENV=local',
      { ORPHAN_AUTH_USER_SWEEP_ENABLED: 'true', TEST_ENV: 'local' },
    ],
    [
      'under TEST_ENV=preview',
      { ORPHAN_AUTH_USER_SWEEP_ENABLED: 'true', TEST_ENV: 'preview' },
    ],
    [
      'on a Vercel preview',
      { ORPHAN_AUTH_USER_SWEEP_ENABLED: 'true', VERCEL_ENV: 'preview' },
    ],
  ])('stays off %s', (_label, env) => {
    expect(orphanAuthUserSweepEnabled(env as NodeJS.ProcessEnv)).toBe(false)
  })
})
