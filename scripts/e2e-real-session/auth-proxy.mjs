/**
 * The real-session harness's Auth proxy.
 *
 * The web build under test points NEXT_PUBLIC_SUPABASE_URL here. Every request is
 * forwarded unchanged to the local Supabase Auth server, so verifyOtp, refresh and
 * sign-out are the real thing. One request is handled here: an OTP request
 * (`POST /auth/v1/otp`) for an account the specs recorded in
 * `created-identities.json`.
 *
 * - `generated` accounts get their code from the Auth Admin API (`generateLink`),
 *   written to a 0600 file in a 0700 directory for the spec helper to read. No
 *   email is sent.
 * - `real-email` accounts are forwarded, so local Auth sends a real email that
 *   the spec reads back from Mailpit.
 *
 * Any other address gets 403: the proxy never issues a code for a user the run
 * did not create. The service-role key stays in this Node process; the web build
 * only ever sees the proxy URL and the anon key.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { findIssuableAccount, isLoopbackHost, otpFileName } from './harness.mjs'

const DROPPED_REQUEST_HEADERS = [
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
]
// fetch() has already decoded the body, so its framing headers no longer apply,
// and the proxy answers CORS for the web origin itself.
const DROPPED_RESPONSE_HEADERS = [
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'access-control-allow-origin',
  'access-control-allow-headers',
  'access-control-allow-methods',
]

function readRecordedAccounts(directory) {
  const file = path.join(directory, 'created-identities.json')
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/**
 * @param {{
 *   directory: string
 *   supabaseUrl: string
 *   serviceRoleKey: string
 *   webOrigin: string
 *   port: number
 * }} options
 */
export async function startAuthProxy({
  directory,
  supabaseUrl,
  serviceRoleKey,
  webOrigin,
  port,
}) {
  const origin = new URL(supabaseUrl)
  if (!isLoopbackHost(origin.hostname))
    throw new Error('The real-session Auth proxy only fronts a local Supabase Auth.')
  if (!serviceRoleKey) throw new Error('The local Auth Admin credential is unavailable.')

  const admin = createClient(origin.href, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const otpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-session-otp-'))
  fs.chmodSync(otpDir, 0o700)
  /** Paths, modes and statuses only: never a body, header or code. */
  const observations = []
  /** Every code minted this run, kept for output redaction after the files are gone. */
  const minted = []
  const observe = (entry) => {
    observations.push(entry)
    fs.writeFileSync(
      path.join(directory, 'auth-observations.json'),
      `${JSON.stringify(observations, null, 2)}\n`
    )
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.setHeader('content-type', 'application/json')
        res.writeHead(503)
      }
      res.end('{"message":"Harness Auth unavailable"}')
    })
  })

  async function handle(req, res) {
    res.setHeader('access-control-allow-origin', webOrigin)
    res.setHeader(
      'access-control-allow-headers',
      'authorization,apikey,content-type,x-client-info,x-supabase-api-version'
    )
    res.setHeader('access-control-allow-methods', 'POST,GET,PUT,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const url = new URL(req.url ?? '/', origin)

    if (url.pathname === '/auth/v1/otp' && req.method === 'POST') {
      const { email } = /** @type {{ email?: unknown }} */ (JSON.parse(body.toString()))
      const account = findIssuableAccount(readRecordedAccounts(directory), email)
      if (!account) {
        observe({ path: url.pathname, mode: 'refused-unrecorded-email', status: 403 })
        res.setHeader('content-type', 'application/json')
        res.writeHead(403)
        res.end('{}')
        return
      }
      if (account.issueMode !== 'real-email') {
        const { data, error } = await admin.auth.admin.generateLink({
          type: 'magiclink',
          email: account.email,
        })
        if (error || !data.properties?.email_otp)
          throw new Error('Owned Admin OTP generation failed')
        minted.push(data.properties.email_otp)
        fs.writeFileSync(
          path.join(otpDir, otpFileName(account.email)),
          JSON.stringify({ code: data.properties.email_otp, issuedAt: Date.now() }),
          { mode: 0o600 }
        )
        observe({ path: url.pathname, mode: 'owned-admin-generateLink', status: 200 })
        res.setHeader('content-type', 'application/json')
        res.writeHead(200)
        res.end('{}')
        return
      }
    }

    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(
        ([name, value]) =>
          typeof value === 'string' && !DROPPED_REQUEST_HEADERS.includes(name)
      )
    )
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : body,
      redirect: 'manual',
    })
    for (const [name, value] of response.headers) {
      if (!DROPPED_RESPONSE_HEADERS.includes(name)) res.setHeader(name, value)
    }
    observe({
      path: url.pathname,
      grantType: url.searchParams.get('grant_type'),
      mode: 'real-local-auth',
      status: response.status,
    })
    res.writeHead(response.status)
    res.end(Buffer.from(await response.arrayBuffer()))
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(undefined))
  })
  // The bound port, so a caller (the unit tests) may ask for port 0.
  const proxyUrl = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`
  // Read by the spec helper; it carries locations only, never a key or a code.
  fs.writeFileSync(
    path.join(directory, 'auth-harness.json'),
    `${JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        proxyUrl,
        otpDir,
        realAuthOrigin: origin.origin,
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )

  return {
    proxyUrl,
    otpDir,
    /** Every code the proxy minted this run, for output redaction. */
    issuedCodes() {
      return [...minted]
    },
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(() => resolve(undefined)))
      fs.rmSync(otpDir, { recursive: true, force: true })
    },
  }
}
