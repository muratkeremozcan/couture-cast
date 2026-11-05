// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: V-TLS. The verifier against a hosted-style endpoint. Every other verifier proof
// connects to a local database in plaintext, so nothing caught that the script could not connect to hosted
// Preview at all. A script that proves enforcement has to know who answered, so a fix that stops verifying
// fails here as surely as one that cannot connect.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  canReachDatabase,
  createHistoryDatabase,
  type HistoryDatabase,
} from './support/moderation-history-database.js'
import {
  generateChain,
  HOSTED_STYLE_HOST,
  startTlsProxy,
  type GeneratedChain,
  type TlsProxy,
} from './support/tls-postgres-proxy.js'

const run = promisify(execFile)
const repoRoot = new URL('../../..', import.meta.url).pathname
const CHECK_COUNT = 16

const reachable = await canReachDatabase()
const automated = process.env.CI === 'true' || process.env.CI === '1'

async function verify(url: string) {
  try {
    const { stdout, stderr } = await run(
      'npx',
      ['--no-install', 'tsx', 'scripts/verify-moderation-history.mjs'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: url,
          NODE_OPTIONS: '--conditions=development',
          // Node's own bypass must never be what makes this pass.
          NODE_TLS_REJECT_UNAUTHORIZED: '1',
        },
      }
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

const okLines = (stdout: string) =>
  stdout.split('\n').filter((line) => line.startsWith('ok ')).length

describe.runIf(reachable || automated)(
  'V-TLS: the verifier on a hosted-style endpoint',
  () => {
    let database: HistoryDatabase
    let chain: GeneratedChain
    let wrongHost: GeneratedChain
    let upstream: { host: string; port: number }
    const proxies: TlsProxy[] = []

    const start = async (options: { chain?: GeneratedChain; tls?: boolean }) => {
      const proxy = await startTlsProxy({ upstream, ...options })
      proxies.push(proxy)
      return proxy
    }
    const hostedUrl = (proxy: TlsProxy, query: string) => {
      const url = new URL(database.appUrl)
      return `postgresql://${url.username}:${url.password}@${HOSTED_STYLE_HOST}:${proxy.port}${url.pathname}${query}`
    }

    beforeAll(async () => {
      if (!reachable)
        throw new Error(
          'CI is set and the test database is unreachable, so 6.13 stays unproven.'
        )
      database = await createHistoryDatabase()
      const url = new URL(database.appUrl)
      upstream = { host: url.hostname, port: Number(url.port) }
      chain = generateChain()
      wrongHost = generateChain('someone-else.example.test')
    }, 180_000)

    afterAll(async () => {
      await Promise.all(proxies.map((proxy) => proxy.close()))
      chain?.remove()
      wrongHost?.remove()
      await database?.drop()
    })

    it('[P0] V-TLS-TRUSTED runs every check when the chain leads to the named CA', async () => {
      const proxy = await start({ chain })
      const result = await verify(
        hostedUrl(proxy, `?sslmode=require&sslcert=${chain.rootPath}&sslaccept=strict`)
      )
      expect(result.stderr).toBe('')
      expect(okLines(result.stdout)).toBe(CHECK_COUNT)
      expect(result.code).toBe(0)
      expect(proxy.handshakes()).toBeGreaterThan(0)
    }, 120_000)

    it('[P0] V-TLS-DEFAULT-PIN refuses a chain the committed CA did not sign, with a bare hosted URL', async () => {
      const proxy = await start({ chain })
      const result = await verify(hostedUrl(proxy, ''))
      expect(result.code).toBe(2)
      expect(okLines(result.stdout)).toBe(0)
      expect(result.stderr).toMatch(/could not run/)
      // Only a code leaves: no host, port, role or password.
      expect(result.stderr).not.toContain(HOSTED_STYLE_HOST)
      expect(result.stderr).not.toContain(new URL(database.appUrl).password)
    }, 120_000)

    it.each(['?sslmode=no-verify', '?sslmode=require', '?sslmode=disable'])(
      '[P0] V-TLS-NO-DOWNGRADE refuses an unknown chain even when the URL says %s',
      async (query) => {
        const proxy = await start({ chain })
        const result = await verify(hostedUrl(proxy, query))
        expect(result.code).toBe(2)
        expect(okLines(result.stdout)).toBe(0)
      },
      120_000
    )

    it('[P0] V-TLS-HOSTNAME refuses a trusted chain issued to another host', async () => {
      const proxy = await start({ chain: wrongHost })
      const result = await verify(
        hostedUrl(
          proxy,
          `?sslmode=require&sslcert=${wrongHost.rootPath}&sslaccept=strict`
        )
      )
      expect(result.code).toBe(2)
      expect(okLines(result.stdout)).toBe(0)
    }, 120_000)

    it('[P0] V-TLS-NO-PLAINTEXT refuses a remote server that offers no TLS', async () => {
      const proxy = await start({ tls: false })
      const result = await verify(
        hostedUrl(proxy, `?sslmode=require&sslcert=${chain.rootPath}&sslaccept=strict`)
      )
      expect(result.code).toBe(2)
      expect(okLines(result.stdout)).toBe(0)
    }, 120_000)

    it('[P1] V-TLS-COMMITTED-CA ships a readable root for the default pin', async () => {
      const { X509Certificate } = await import('node:crypto')
      const { readFileSync } = await import('node:fs')
      const certificate = new X509Certificate(
        readFileSync(`${repoRoot}apps/api/certs/supabase-root-2021-ca.pem`)
      )
      expect(certificate.ca).toBe(true)
      expect(certificate.subject).toMatch(/Supabase Root 2021 CA/)
    })
  }
)
