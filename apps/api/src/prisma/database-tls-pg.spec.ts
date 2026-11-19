// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: a real TLS handshake through the real `pg` driver with the options the verifier uses.
// `moderation:history:verify` failed on the hosted database with SELF_SIGNED_CERT_IN_CHAIN before this.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net, { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifiedPgConnection } from '../../../../scripts/lib/database-tls.mjs'

/**
 * Generous real-time limits: the full API run shares the machine with other suites, and at load
 * average 175 one run failed this file while every case passed alone. The connect limit stays under
 * the case limit, so a slow handshake reports its own outcome instead of a bare case timeout.
 */
const CONNECT_TIMEOUT_MS = 15_000
const CASE_TIMEOUT_MS = 30_000

/** Handshakes the fake server finished; the CA-signed case must add exactly one. */
let handshakes = 0

/** Answers Postgres's SSLRequest with yes, finishes TLS, then closes before any protocol. */
function tlsPostgres(key: string, cert: string): net.Server {
  return net.createServer((socket) => {
    socket.once('data', () => {
      socket.write('S', () => {
        const secure = new tls.TLSSocket(socket, {
          isServer: true,
          key,
          cert,
        })
        secure.on('secure', () => {
          handshakes += 1
          secure.destroy()
        })
        secure.on('error', () => socket.destroy())
      })
    })
    socket.on('error', () => undefined)
  })
}

describe('the verifier connection against a real TLS server', () => {
  let dir: string
  let cert: string
  let server: net.Server
  let port: number

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc613-tls-'))
    const keyPath = path.join(dir, 'key.pem')
    const certPath = path.join(dir, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { stdio: 'ignore', timeout: CASE_TIMEOUT_MS }
    )
    cert = readFileSync(certPath, 'utf8')
    server = tlsPostgres(readFileSync(keyPath, 'utf8'), cert)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  }, CASE_TIMEOUT_MS)

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })

  // The connection string names a remote host so the options are the remote ones, and the socket goes here.
  const connect = (url: string, options?: Parameters<typeof verifiedPgConnection>[1]) => {
    const { ssl } = verifiedPgConnection(url, options)
    const client = new pg.Client({
      host: '127.0.0.1',
      port,
      user: 'probe',
      database: 'probe',
      password: 'probe',
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      ...(ssl ? { ssl } : {}),
    })
    client.on('error', () => undefined)
    return client.connect().then(
      () => client.end().then(() => 'connected'),
      (error: { code?: string; message?: string }) =>
        error.code ?? error.message ?? 'failed'
    )
  }

  const REMOTE = 'postgresql://u:p@db.example.supabase.co:5432/postgres'

  it(
    'refuses a server certificate the committed CA did not sign',
    async () => {
      expect(await connect(REMOTE)).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
    },
    CASE_TIMEOUT_MS
  )

  it(
    'refuses it even when the URL asks for no verification',
    async () => {
      expect(await connect(`${REMOTE}?sslmode=no-verify`)).toBe(
        'DEPTH_ZERO_SELF_SIGNED_CERT'
      )
    },
    CASE_TIMEOUT_MS
  )

  it(
    'finishes the handshake when the CA did sign it',
    async () => {
      const before = handshakes
      const outcome = await connect(REMOTE, {
        caPath: path.join(dir, 'cert.pem'),
      })
      // The fake server hangs up once TLS is done, so the driver's complaint is about the closed
      // stream. The server's count proves TLS finished on its side too.
      expect(outcome).toBe('Connection terminated unexpectedly')
      expect(handshakes - before).toBe(1)
    },
    CASE_TIMEOUT_MS
  )
})
