import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import {
  mintedValuePatterns,
  resolveSecrets,
  scanPaths,
} from '../../../scripts/check-artifact-secrets.mjs'

const playwrightRequire = createRequire(__filename)
const jwt = [
  JSON.stringify({ alg: 'HS256' }),
  JSON.stringify({ sub: 'fixture-member' }),
  'synthetic-unsigned-test-value',
]
  .map((part) => Buffer.from(part).toString('base64url'))
  .join('.')
const authFixture = {
  PROD_SYNTHETIC_MEMBER_PASSWORD: 'fixture-only-password',
  FIXTURE_REFRESH_TOKEN: 'must-stay-in-the-runner',
}

it('masks a synthetic bearer in the runner and blocks the same command in a worker report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prod-member-artifacts-'))
  const setup = resolve(__dirname, '../../global-setup-prod-member.ts')
  const helper = resolve(__dirname, 'prod-synthetic-member.ts')
  const pw = JSON.stringify(playwrightRequire.resolve('@playwright/test'))
  try {
    writeFileSync(
      join(dir, 'playwright.config.ts'),
      `export default {
        globalSetup: './setup.ts',
        reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
      }`
    )
    writeFileSync(
      join(dir, 'setup.ts'),
      `import setupProdMember from ${JSON.stringify(setup)}
      import { PROD_MEMBER_SESSION_ENV } from ${JSON.stringify(helper)}
      export default async () => {
        const calls: string[] = []
        globalThis.fetch = async (url) => {
          calls.push(String(url))
          if (String(url).endsWith('/auth/v1/token?grant_type=password')) return Response.json({
            access_token: ${JSON.stringify(jwt)},
            refresh_token: ${JSON.stringify(authFixture.FIXTURE_REFRESH_TOKEN)},
            user: { id: 'fixture-member' },
          })
          if (String(url).endsWith('/auth/v1/logout?scope=local')) return new Response(null, { status: 204 })
          throw new Error('Unexpected request in the member artifact fixture.')
        }
        const teardown = await setupProdMember()
        return async () => {
          await teardown?.()
          if (process.env[PROD_MEMBER_SESSION_ENV] || calls.length !== 2 || !calls[1].endsWith('/logout?scope=local')) {
            throw new Error('Expected runner teardown to remove and revoke its session.')
          }
        }
      }`
    )
    writeFileSync(
      join(dir, 'member.spec.ts'),
      `import { test, expect } from ${pw}
      import { prodMemberFromRunner } from ${JSON.stringify(helper)}
      test('reads the runner session', () => {
        const member = prodMemberFromRunner()
        expect(member.authUserId).toBe('fixture-member')
        expect(member.session.refresh_token).toBe('synthetic-member-run-only')
        if (process.env.EMIT_LEGACY_WORKER_MASK === 'true') console.log('::add-mask::' + member.accessToken)
      })`
    )

    const { secrets } = resolveSecrets(Object.keys(authFixture), authFixture)
    const checks = [...secrets, ...mintedValuePatterns([], true)]
    for (const legacyMask of [false, true]) {
      const run = spawnSync(
        process.execPath,
        [playwrightRequire.resolve('@playwright/test/cli'), 'test'],
        {
          cwd: dir,
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            PATH: process.env.PATH,
            CI: 'true',
            GITHUB_ACTIONS: 'true',
            PROD_SUPABASE_URL: 'https://abcdefghij0123456789.supabase.co',
            PROD_SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
            PROD_SYNTHETIC_MEMBER_PASSWORD: authFixture.PROD_SYNTHETIC_MEMBER_PASSWORD,
            EMIT_LEGACY_WORKER_MASK: String(legacyMask),
          },
        }
      )
      expect(run.status, run.stderr).toBe(0)
      expect(run.stdout).toContain(`::add-mask::${jwt}`)
      const report = join(dir, 'playwright-report', 'index.html')
      const scan = scanPaths([report], checks)
      expect(scan.files).toBe(1)
      expect(scan.unreadable).toEqual([])
      if (legacyMask) {
        expect(scan.findings).toHaveLength(1)
        const [finding] = scan.findings
        expect(finding?.location).toMatch(/index\.html!base64#\d+!entry#\d+$/)
        expect(finding).toMatchObject({
          name: 'a JWT-shaped value',
          encoding: 'JWT shape',
        })
      } else {
        expect(scan.findings).toEqual([])
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 25_000)
