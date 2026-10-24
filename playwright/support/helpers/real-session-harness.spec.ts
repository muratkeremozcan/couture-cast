/**
 * Unit tests for `scripts/e2e-real-session/`, the harness the CI job
 * "Real-session community E2E" runs the Story 6.5 real-session specs in. Lives
 * here because `npm run test:playwright-unit` already runs this directory before
 * every Playwright entrypoint, the real-session one included.
 *
 * The rules held here are the ones that keep the harness scoped: it creates and
 * drops only `tea_community_<32 hex>` databases, issues OTPs only for addresses it
 * recorded, deletes only the Auth users it recorded, and prints nothing that still
 * carries a key, a code or a JWT. Every key and code below is a dummy.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAuthProxy } from '../../../scripts/e2e-real-session/auth-proxy.mjs'
import { deleteRecordedUsers } from '../../../scripts/e2e-real-session/cleanup-users.mjs'
import {
  assertIsolatedDatabaseUrl,
  envKeysToBlank,
  findIssuableAccount,
  isolatedDatabaseName,
  isolatedDatabaseUrl,
  otpFileName,
  redactSecrets,
  resolveHarnessDir,
  resolveOtpMode,
  selectRecordedUsers,
} from '../../../scripts/e2e-real-session/harness.mjs'

const SOURCE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const ISOLATED = `tea_community_${'a1'.repeat(16)}`
const EMAIL = 'story65-real-0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b@example.test'
const OTHER_EMAIL = 'story65-real-9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d@example.test'
const AUTH_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const OTHER_AUTH_ID = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a'
const DUMMY_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkdW1teS1zdWJqZWN0In0.ZHVtbXktc2lnbmF0dXJlLXZhbHVl'

let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'real-session-harness-'))
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

function recordIdentities(rows: unknown[]) {
  fs.writeFileSync(path.join(directory, 'created-identities.json'), JSON.stringify(rows))
}

function readIdentities() {
  return JSON.parse(
    fs.readFileSync(path.join(directory, 'created-identities.json'), 'utf8')
  ) as unknown[]
}

describe('isolated database names', () => {
  it('R50-RS-01 names a tea_community_<32 hex> database on the same local server', () => {
    const name = isolatedDatabaseName(() => '0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b')
    expect(name).toBe('tea_community_0f8e2a4c1b3d4e5f8a9b0c1d2e3f4a5b')
    expect(isolatedDatabaseUrl(SOURCE, name)).toBe(
      `postgresql://postgres:postgres@127.0.0.1:54322/${name}`
    )
  })

  it('R50-RS-02 refuses any other database name or a remote server', () => {
    expect(() => isolatedDatabaseUrl(SOURCE, 'postgres')).toThrow(/tea_community_/)
    expect(() =>
      isolatedDatabaseUrl(
        'postgresql://u:p@db.remote.example.com:5432/postgres',
        ISOLATED
      )
    ).toThrow(/local server/)
  })

  it('R50-RS-03 accepts only an isolated local DATABASE_URL', () => {
    expect(assertIsolatedDatabaseUrl(isolatedDatabaseUrl(SOURCE, ISOLATED))).toBe(
      ISOLATED
    )
    expect(() => assertIsolatedDatabaseUrl(SOURCE)).toThrow(/isolated/)
    expect(() =>
      assertIsolatedDatabaseUrl(`postgresql://u:p@db.remote.example.com:5432/${ISOLATED}`)
    ).toThrow(/local server/)
    expect(() => assertIsolatedDatabaseUrl(undefined)).toThrow(/not a URL/)
  })
})

describe('OTP issuance scope', () => {
  it('R50-RS-04 issues only for an exact harness address the specs recorded', () => {
    const rows = [
      { email: EMAIL, issueMode: 'generated' },
      { email: 'someone@example.com', issueMode: 'generated' },
    ]
    expect(findIssuableAccount(rows, EMAIL)).toEqual(rows[0])
    expect(findIssuableAccount(rows, OTHER_EMAIL)).toBeUndefined()
    expect(findIssuableAccount(rows, 'someone@example.com')).toBeUndefined()
    expect(findIssuableAccount(rows, EMAIL.toUpperCase())).toBeUndefined()
    expect(findIssuableAccount(rows, { email: EMAIL })).toBeUndefined()
  })

  it('R50-RS-05 names the code file the spec helper reads', () => {
    expect(otpFileName(EMAIL)).toBe(
      `${createHash('sha256').update(EMAIL).digest('hex')}.json`
    )
  })

  it('R50-RS-06 picks the OTP mode, and refuses a real-email run without Mailpit', () => {
    expect(resolveOtpMode(undefined, true)).toBe('real-email')
    expect(resolveOtpMode('', false)).toBe('generated')
    expect(resolveOtpMode('generated', true)).toBe('generated')
    expect(resolveOtpMode(' Real-Email ', true)).toBe('real-email')
    expect(() => resolveOtpMode('real-email', false)).toThrow(/needs Mailpit/)
    expect(() => resolveOtpMode('magic', true)).toThrow(/Unsupported/)
  })
})

describe('Auth user cleanup', () => {
  it('R50-RS-07 selects harness users once each and refuses every other row', () => {
    const { deletable, refused } = selectRecordedUsers([
      { email: EMAIL, authUserId: AUTH_ID, label: 'first' },
      { email: EMAIL, authUserId: AUTH_ID, label: 'first-again' },
      { email: 'admin@example.com', authUserId: OTHER_AUTH_ID, label: 'foreign' },
      { email: OTHER_EMAIL, authUserId: 'not-a-uuid', label: 'bad-id' },
      { email: OTHER_EMAIL },
    ])
    expect(deletable).toEqual([{ authUserId: AUTH_ID, email: EMAIL, label: 'first' }])
    expect(refused).toEqual(['foreign', 'bad-id', 'unlabelled'])
  })

  it('R50-RS-08 deletes the recorded users and keeps only a failed one for a retry', async () => {
    const failing = { email: OTHER_EMAIL, authUserId: OTHER_AUTH_ID, label: 'second' }
    recordIdentities([{ email: EMAIL, authUserId: AUTH_ID, label: 'first' }, failing])
    const deleteUser = vi.fn((id: string) =>
      Promise.resolve(
        id === AUTH_ID
          ? { status: 'deleted' as const }
          : { status: 'failed' as const, reason: 'Auth unavailable' }
      )
    )

    const summary = await deleteRecordedUsers({ directory, deleteUser })

    expect(deleteUser.mock.calls.map(([id]) => id)).toEqual([AUTH_ID, OTHER_AUTH_ID])
    expect(summary).toEqual({
      recorded: 2,
      deleted: 1,
      missing: 0,
      failed: [{ label: 'second', reason: 'Auth unavailable' }],
    })
    expect(readIdentities()).toEqual([failing])
  })

  it('R50-RS-09 counts an already-deleted user as done', async () => {
    recordIdentities([{ email: EMAIL, authUserId: AUTH_ID, label: 'first' }])
    const summary = await deleteRecordedUsers({
      directory,
      deleteUser: () => Promise.resolve({ status: 'missing' as const }),
    })
    expect(summary).toMatchObject({ recorded: 1, deleted: 0, missing: 1, failed: [] })
    expect(readIdentities()).toEqual([])
  })

  it('R50-RS-10 deletes nothing when the file holds a row the specs did not write', async () => {
    const rows = [
      { email: EMAIL, authUserId: AUTH_ID, label: 'first' },
      { email: 'admin@example.com', authUserId: OTHER_AUTH_ID, label: 'foreign' },
    ]
    recordIdentities(rows)
    const deleteUser = vi.fn(() => Promise.resolve({ status: 'deleted' as const }))

    await expect(deleteRecordedUsers({ directory, deleteUser })).rejects.toThrow(
      /Refusing to delete anything.*foreign/
    )
    expect(deleteUser).not.toHaveBeenCalled()
    expect(readIdentities()).toEqual(rows)
  })

  it('R50-RS-11 has nothing to do when the run recorded nobody', async () => {
    const deleteUser = vi.fn()
    expect(await deleteRecordedUsers({ directory, deleteUser })).toEqual({
      recorded: 0,
      deleted: 0,
      missing: 0,
      failed: [],
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })
})

describe('output redaction', () => {
  it('R50-RS-12 removes keys, codes and JWTs, longest value first', () => {
    const key = 'dummy-service-role-key-0123456789'
    const output = [
      `service ${key}`,
      `prefix ${key}-suffix`,
      'code 482913 entered',
      `bearer ${DUMMY_JWT}`,
      'short 12345 stays',
    ].join('\n')

    const redacted = redactSecrets(output, [
      'dummy-service-role-key',
      key,
      '482913',
      '12345',
      undefined,
      '',
    ])

    expect(redacted).toBe(
      [
        'service [REDACTED]',
        'prefix [REDACTED]-suffix',
        'code [REDACTED] entered',
        'bearer [REDACTED_JWT]',
        'short 12345 stays',
      ].join('\n')
    )
  })
})

describe('web build environment', () => {
  it('R50-RS-13 blanks every env-file key the harness did not provide', () => {
    expect(
      envKeysToBlank(
        [
          'SUPABASE_SERVICE_ROLE_KEY',
          'API_BASE_URL',
          'PROD_API_BASE_URL',
          'API_BASE_URL',
        ],
        { API_BASE_URL: 'http://127.0.0.1:4077' }
      )
    ).toEqual(['PROD_API_BASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
  })

  it('R50-RS-14 resolves the run directory from the environment or the default', () => {
    expect(resolveHarnessDir({}, '/repo')).toBe('/repo/.real-session-e2e')
    expect(resolveHarnessDir({ STORY65_REAL_SESSION_DIR: '/tmp/run' }, '/repo')).toBe(
      '/tmp/run'
    )
  })
})

describe('Auth proxy', () => {
  type Seen = { method?: string; url?: string; body: string }
  let upstream: http.Server
  let seen: Seen[]
  let proxy: Awaited<ReturnType<typeof startAuthProxy>> | undefined

  beforeEach(async () => {
    seen = []
    // Stands in for local Supabase Auth: the Admin generate_link call and every
    // forwarded request land here.
    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString(),
        })
        res.setHeader('content-type', 'application/json')
        if (req.url?.startsWith('/auth/v1/admin/generate_link')) {
          res.writeHead(200)
          res.end(
            JSON.stringify({
              id: AUTH_ID,
              email: EMAIL,
              action_link: 'http://127.0.0.1/verify',
              email_otp: '482913',
              hashed_token: 'dummy-hash',
              redirect_to: '',
              verification_type: 'magiclink',
            })
          )
          return
        }
        res.writeHead(req.url === '/auth/v1/otp' ? 200 : 207)
        res.end('{"forwarded":true}')
      })
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    proxy = await startAuthProxy({
      directory,
      supabaseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      serviceRoleKey: 'dummy-service-role-key-0123456789',
      webOrigin: 'http://127.0.0.1:3077',
      port: 0,
    })
  })

  afterEach(async () => {
    await proxy?.close()
    await new Promise((resolve) => upstream.close(resolve))
  })

  const requestOtp = (email: string) =>
    fetch(`${proxy!.proxyUrl}/auth/v1/otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, create_user: false }),
    })

  it('R50-RS-15 refuses an OTP for an address the specs did not record', async () => {
    recordIdentities([{ email: OTHER_EMAIL, issueMode: 'generated' }])

    expect((await requestOtp(EMAIL)).status).toBe(403)
    expect((await requestOtp('admin@example.com')).status).toBe(403)

    expect(seen).toEqual([])
    expect(fs.readdirSync(proxy!.otpDir)).toEqual([])
  })

  it('R50-RS-16 mints a generated account code through the Admin API without sending mail', async () => {
    recordIdentities([{ email: EMAIL, issueMode: 'generated' }])

    expect((await requestOtp(EMAIL)).status).toBe(200)

    expect(seen.map((request) => request.url)).toEqual(['/auth/v1/admin/generate_link'])
    const file = path.join(proxy!.otpDir, otpFileName(EMAIL))
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ code: '482913' })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(proxy!.issuedCodes()).toEqual(['482913'])
    const harness = JSON.parse(
      fs.readFileSync(path.join(directory, 'auth-harness.json'), 'utf8')
    ) as Record<string, unknown>
    expect(harness).toMatchObject({ proxyUrl: proxy!.proxyUrl, otpDir: proxy!.otpDir })
    expect(JSON.stringify(harness)).not.toContain('dummy-service-role-key')
  })

  it('R50-RS-17 forwards a real-email OTP and every other Auth call to local Auth', async () => {
    recordIdentities([{ email: EMAIL, issueMode: 'real-email' }])

    expect((await requestOtp(EMAIL)).status).toBe(200)
    const refresh = await fetch(
      `${proxy!.proxyUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3077' },
        body: '{"refresh_token":"dummy"}',
      }
    )

    expect(refresh.status).toBe(207)
    expect(refresh.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:3077'
    )
    expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST /auth/v1/otp',
      'POST /auth/v1/token?grant_type=refresh_token',
    ])
    expect(fs.readdirSync(proxy!.otpDir)).toEqual([])
  })

  it('R50-RS-18 answers the browser preflight for the web origin only', async () => {
    const preflight = await fetch(`${proxy!.proxyUrl}/auth/v1/otp`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:3077'
    )
    expect(seen).toEqual([])
  })

  it('R50-RS-19 removes the code directory on close', async () => {
    const otpDir = proxy!.otpDir
    await proxy!.close()
    proxy = undefined
    expect(fs.existsSync(otpDir)).toBe(false)
  })
})
