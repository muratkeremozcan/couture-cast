/**
 * Story 6.16 E-CONV-REAL-STACK on mobile: the runner side of the guest conversion leg.
 *
 * `maestro/guest-preview-conversion.yaml` (step 1) sets a comfort proposal in the preview,
 * creates an account for a synthetic address and requests a sign-in code. The runner then:
 *
 *   1. reads the code local Supabase Auth sent to Mailpit (`readMailpitCode`), polling with
 *      a deadline;
 *   2. lists it for the artifact secret scan (`recordIssuedCode`) BEFORE any process sees it;
 *   3. runs step 2 with the code only as MAESTRO_OTP in that Maestro child's environment,
 *      its output captured privately and published redacted (`runPrivateMaestro`);
 *   4. checks the saved comfort row equals the proposal (`comfortMismatch`).
 *
 * `runGuestConversionLeg` holds that order. The address is recorded write-ahead before
 * step 1 starts (`recordGuestAccount`), so cleanup (`cleanupGuestAccounts`) finds the app
 * user and the Auth user even when the run dies part way.
 *
 * Packages load on use: run-maestro.mjs imports this module before any install proof, and
 * its bootstrap spec runs it from a copy with no node_modules.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import {
  readIdentities,
  recordPendingIdentity,
  writeIdentities,
} from '../e2e-real-session/identities.mjs'

// The three helpers below mirror scripts/e2e-real-session/harness.mjs, which resolves the
// Mailpit URL from supabase/config.toml when imported. This module keeps no import-time side
// effects, so run-maestro.mjs's bootstrap spec can load it from a bare copy.

/**
 * The sign-in code in a Mailpit message body, the pattern `extractMailCode` uses.
 *
 * @param {string} body
 */
export const extractSignInCode = (body) => body.match(/\b(\d{6,10})\b/)?.[1]

/** @param {string} hostname */
export const isLoopbackHost = (hostname) =>
  ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

/**
 * Replaces every listed secret, longest first, then anything shaped like a JWT.
 *
 * @param {string} text
 * @param {readonly (string | undefined)[]} secrets
 */
export function redactSecrets(text, secrets) {
  const values = [...new Set(secrets.filter((value) => value && value.length >= 6))]
    .map(String)
    .sort((left, right) => right.length - left.length)
  let output = text
  for (const value of values) output = output.split(value).join('[REDACTED]')
  return output.replace(JWT, '[REDACTED_JWT]')
}

export const GUEST_CONVERSION_FLOW = 'maestro/guest-preview-conversion.yaml'
export const GUEST_CONVERSION_VERIFY_FLOW =
  'maestro/guest-preview/guest-preview-conversion-verify.yaml'

/** What step 1 proposes; the column names of `ComfortPreferences`. */
export const GUEST_CONVERSION_PROPOSAL = Object.freeze({
  runs_cold_warm: 'cold',
  wind_tolerance: 'low',
  precip_preparedness: 'high',
})

/** The only addresses this leg creates, and so the only ones cleanup deletes. */
export const GUEST_EMAIL =
  /^mobile-guest-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.test$/

/** @param {() => string} [uuid] */
export const guestConversionEmail = (uuid = randomUUID) =>
  `mobile-guest-${uuid()}@example.test`

/** Where the write-ahead account record lives between runs, relative to the repo. */
export const GUEST_STATE_DIR = '.maestro-guest-preview'

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} projectRoot
 */
export const resolveGuestStateDir = (env, projectRoot) =>
  path.resolve(projectRoot, env.MOBILE_E2E_GUEST_STATE_DIR || GUEST_STATE_DIR)

const message = (error) => (error instanceof Error ? error.message : String(error))

/**
 * Records the address before the flow that creates its accounts runs.
 *
 * @param {string} directory
 * @param {string} email
 */
export function recordGuestAccount(directory, email) {
  if (!GUEST_EMAIL.test(email))
    throw new Error(
      'Refusing to record an address outside mobile-guest-<uuid>@example.test.'
    )
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  recordPendingIdentity(directory, { email, label: 'guest-conversion' })
}

/**
 * Starts the run's list of issued sign-in codes, empty. CI hands the file to
 * `check-artifact-secrets.mjs --otp-file`, which fails closed on a missing file.
 *
 * @param {string | undefined} file
 */
export function startIssuedCodeFile(file) {
  if (!file) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '[]\n', { mode: 0o600 })
}

/**
 * Appends one code to the list, atomically. Called before the code reaches any process.
 *
 * @param {string | undefined} file
 * @param {string} code
 */
export function recordIssuedCode(file, code) {
  if (!file) return
  const codes = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  if (!Array.isArray(codes)) throw new Error('The issued-code list is not a list.')
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify([...codes, code])}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * The newest sign-in code Mailpit received for `email` at or after `sinceMs`, polled
 * until `timeoutMs`. Errors never carry a code.
 *
 * @param {{
 *   mailpitUrl: string
 *   email: string
 *   sinceMs: number
 *   fetchImpl?: typeof fetch
 *   timeoutMs?: number
 *   intervalMs?: number
 *   now?: () => number
 *   sleep?: (ms: number) => Promise<void>
 * }} options
 * @returns {Promise<string>}
 */
export async function readMailpitCode({
  mailpitUrl,
  email,
  sinceMs,
  fetchImpl = fetch,
  timeoutMs = 60_000,
  intervalMs = 1_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const wanted = email.toLowerCase()
  const read = async (url) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Mailpit answered ${response.status}`)
    return response.json()
  }
  const deadline = now() + timeoutMs
  let lastError
  for (;;) {
    try {
      const page = await read(`${mailpitUrl}/api/v1/messages?limit=50`)
      const messages = (page.messages ?? [])
        .filter((item) =>
          item.To?.some((to) => String(to.Address).toLowerCase() === wanted)
        )
        // A second of slack: Mailpit stamps the message on receipt, on this host's clock.
        .filter((item) => Date.parse(item.Created) >= sinceMs - 1_000)
        .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))
      for (const item of messages) {
        const content = await read(`${mailpitUrl}/api/v1/message/${item.ID}`)
        const code = extractSignInCode(`${content.Text ?? ''}\n${content.HTML ?? ''}`)
        if (code) return code
      }
      lastError = undefined
    } catch (error) {
      lastError = error
    }
    if (now() >= deadline)
      throw new Error(
        `No sign-in code reached Mailpit at ${mailpitUrl} for the guest address within ${Math.round(timeoutMs / 1000)} s` +
          (lastError ? ` (last error: ${message(lastError)})` : '.')
      )
    await sleep(intervalMs)
  }
}

/**
 * Why the saved comfort row is not the proposal, or undefined when it is.
 *
 * @param {Record<string, unknown> | null | undefined} row
 * @param {Readonly<Record<string, string>>} [proposal]
 */
export function comfortMismatch(row, proposal = GUEST_CONVERSION_PROPOSAL) {
  if (!row) return 'no comfort preferences row exists for the converted account'
  const wrong = Object.entries(proposal)
    .filter(([column, value]) => row[column] !== value)
    .map(([column, value]) => `${column} is ${String(row[column])}, expected ${value}`)
  return wrong.length > 0
    ? `the saved comfort row is not the proposal: ${wrong.join('; ')}`
    : undefined
}

/**
 * The leg after step 1 passed, in its one safe order. Resolves to the cause the
 * conversion flow fails with, or undefined; no cause ever carries the code.
 *
 * @param {{
 *   readCode: () => Promise<string>
 *   recordCode: (code: string) => void
 *   runVerifyFlow: (code: string) => Promise<void>
 *   verifyComfort: () => Promise<string | undefined>
 * }} steps
 * @returns {Promise<string | undefined>}
 */
export async function runGuestConversionLeg({
  readCode,
  recordCode,
  runVerifyFlow,
  verifyComfort,
}) {
  let code
  try {
    code = await readCode()
  } catch (error) {
    return message(error)
  }
  const redact = (text) => redactSecrets(text, [code])
  try {
    recordCode(code)
  } catch (error) {
    return `the issued code could not be listed for the artifact scan, so it was not used: ${redact(message(error))}`
  }
  try {
    await runVerifyFlow(code)
  } catch (error) {
    return `the sign-in verify step failed: ${redact(message(error))}`
  }
  try {
    return await verifyComfort()
  } catch (error) {
    return `the saved comfort row could not be read: ${redact(message(error))}`
  }
}

/**
 * Runs Maestro with its output captured, never echoed: a flow that types a secret has it
 * in Maestro's console lines. The redacted output goes to `logFile`; the error names only
 * the exit. The first command missing from PATH falls through to the next.
 *
 * @param {{
 *   commands: string[][]
 *   args: string[]
 *   env: NodeJS.ProcessEnv
 *   secrets: string[]
 *   timeoutMs: number
 *   logFile?: string
 *   spawnImpl?: typeof spawn
 * }} options
 * @returns {Promise<void>}
 */
export async function runPrivateMaestro({
  commands,
  args,
  env,
  secrets,
  timeoutMs,
  logFile,
  spawnImpl = spawn,
}) {
  for (const [command, ...prefix] of commands) {
    const output = []
    // eslint-disable-next-line no-await-in-loop -- the next command runs only on ENOENT
    const result = await new Promise((resolve) => {
      const child = spawnImpl(command, [...prefix, ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const timer = setTimeout(() => child.kill('SIGINT'), timeoutMs)
      child.stdout?.on('data', (data) => output.push(data))
      child.stderr?.on('data', (data) => output.push(data))
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ error })
      })
      child.on('exit', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal })
      })
    })
    if (result.error?.code === 'ENOENT') continue
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      fs.writeFileSync(
        logFile,
        redactSecrets(
          `$ ${command} ${[...prefix, ...args].join(' ')}\n${Buffer.concat(output).toString('utf8')}`,
          secrets
        )
      )
    }
    if (result.error) throw new Error(`${command} could not start (${result.error.code})`)
    if (result.code !== 0)
      throw new Error(
        `${command} exited with ${result.signal ? `signal ${result.signal}` : `code ${result.code}`}`
      )
    return
  }
  throw new Error('No Maestro command was found.')
}

/**
 * Copies a file with every secret redacted, when it exists.
 *
 * @param {string} from
 * @param {string} to
 * @param {string[]} secrets
 */
export function publishRedacted(from, to, secrets) {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.writeFileSync(to, redactSecrets(fs.readFileSync(from, 'utf8'), secrets))
}

/**
 * Copies a Maestro debug directory for the artifacts: text files with every secret
 * redacted, binary files (screenshots) as they are. The artifact scan still reads every
 * copied byte and fails on any listed code left in them.
 *
 * @param {string} fromDir
 * @param {string} toDir
 * @param {string[]} secrets
 * @param {{ skip?: string[] }} [options] paths relative to `fromDir` left out
 */
export function publishRedactedTree(
  fromDir,
  toDir,
  secrets,
  { skip = [], images = true } = {}
) {
  if (!fs.existsSync(fromDir)) return
  for (const entry of fs.readdirSync(fromDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const from = path.join(entry.parentPath, entry.name)
    const relative = path.relative(fromDir, from)
    if (skip.includes(relative)) continue
    const to = path.join(toDir, relative)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    const bytes = fs.readFileSync(from)
    if (!bytes.includes(0))
      fs.writeFileSync(to, redactSecrets(bytes.toString('utf8'), secrets))
    else if (images) fs.writeFileSync(to, bytes)
  }
}

/**
 * Whether the verify step's screenshots can be published. The scan cannot read text in an
 * image and the sign-in code field is not masked, so a screenshot may show the code from
 * the moment it is typed until the app leaves the sign-in screen. Images are safe only when
 * Maestro's command log shows the code step never started, or that the carryover review
 * (`leftSignInMarker`) was visible after it. A missing or unreadable log, or a code step
 * with any other status or none, keeps them all out.
 *
 * @param {string} debugDir
 * @param {string} code
 * @param {string} leftSignInMarker
 * @returns {boolean}
 */
export function verifyScreenshotsArePublishable(debugDir, code, leftSignInMarker) {
  if (!fs.existsSync(debugDir)) return false
  const logs = fs
    .readdirSync(debugDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /^commands-.*\.json$/.test(entry.name))
  if (logs.length === 0) return false
  for (const entry of logs) {
    let commands
    try {
      commands = JSON.parse(
        fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8')
      )
    } catch {
      return false
    }
    if (!Array.isArray(commands)) return false
    // The code step, found by the code itself, its variable or any text input (the flow
    // types nothing else), so a log that records it unresolved still counts.
    const typed = commands.findIndex((item) => {
      const text = JSON.stringify(item?.command ?? null)
      return (
        text.includes(code) || text.includes('MAESTRO_OTP') || text.includes('inputText')
      )
    })
    if (typed === -1) continue
    const status = commands[typed]?.metadata?.status
    // Not started: the failure came before the code reached the screen.
    if (status === 'PENDING' || status === 'SKIPPED') continue
    const left = commands.findIndex(
      (item, index) =>
        index > typed &&
        item?.metadata?.status === 'COMPLETED' &&
        JSON.stringify(item?.command ?? null).includes(leftSignInMarker)
    )
    if (left === -1) return false
  }
  return true
}

/**
 * Deletes the app user and the Auth user of every recorded address, then drops the rows
 * it settled. A failed row stays for the next run; a row of any other address refuses
 * the whole cleanup.
 *
 * @param {{
 *   directory: string
 *   deleteAppUser: (email: string) => Promise<void>
 *   deleteAuthUser: (email: string) => Promise<void>
 * }} options
 * @returns {Promise<{ recorded: number, settled: number, failed: string[] }>}
 */
export async function cleanupGuestAccounts({ directory, deleteAppUser, deleteAuthUser }) {
  const rows = readIdentities(directory)
  if (rows.length === 0) return { recorded: 0, settled: 0, failed: [] }
  const refused = rows.filter((row) => !GUEST_EMAIL.test(String(row.email)))
  if (refused.length > 0)
    throw new Error(
      `Refusing guest cleanup: ${refused.length} recorded row(s) are not guest preview addresses.`
    )
  const settled = new Set()
  const failed = []
  for (const email of new Set(rows.map((row) => String(row.email)))) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one account at a time
      await deleteAppUser(email)
      // eslint-disable-next-line no-await-in-loop -- one account at a time
      await deleteAuthUser(email)
      settled.add(email)
    } catch (error) {
      failed.push(`${email}: ${message(error)}`)
    }
  }
  writeIdentities(
    directory,
    readIdentities(directory).filter((row) => !settled.has(String(row.email)))
  )
  return { recorded: rows.length, settled: settled.size, failed }
}

/**
 * The local Supabase this leg signs in against: from the environment CI exports, else
 * `supabase status`. Only a loopback URL is accepted.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {() => { API_URL?: string, ANON_KEY?: string, SERVICE_ROLE_KEY?: string }} readStatus
 */
export function resolveLocalSupabase(env, readStatus) {
  const fromEnv = {
    url: env.SUPABASE_URL?.trim(),
    anonKey: env.SUPABASE_ANON_KEY?.trim(),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  }
  const status = Object.values(fromEnv).every(Boolean) ? {} : readStatus()
  const resolved = {
    url: fromEnv.url || status.API_URL || '',
    anonKey: fromEnv.anonKey || status.ANON_KEY || '',
    serviceRoleKey: fromEnv.serviceRoleKey || status.SERVICE_ROLE_KEY || '',
  }
  if (!Object.values(resolved).every(Boolean))
    throw new Error('The local Supabase URL or keys could not be resolved.')
  if (!isLoopbackHost(new URL(resolved.url).hostname))
    throw new Error(
      'SUPABASE_URL must point at the local Supabase for the guest conversion.'
    )
  return resolved
}

/**
 * The Supabase URL as the device reaches it: the host's loopback port, through the same
 * host address the bundle uses for the API.
 *
 * @param {string} url
 * @param {string} host
 */
export function deviceSupabaseUrl(url, host) {
  const parsed = new URL(url)
  parsed.hostname = host
  return parsed.toString().replace(/\/$/, '')
}

/**
 * Auth Admin deletion by guest address on the local Supabase.
 *
 * @param {{ url: string, serviceRoleKey: string }} supabase
 */
export function localGuestAuthAdmin({ url, serviceRoleKey }) {
  if (!isLoopbackHost(new URL(url).hostname))
    throw new Error('Guest cleanup only deletes users from a local Supabase Auth.')
  const { createClient } = createRequire(import.meta.url)('@supabase/supabase-js')
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return {
    /** @param {string} email */
    async deleteByEmail(email) {
      if (!GUEST_EMAIL.test(email)) throw new Error('not a guest preview address')
      for (let page = 1; ; page++) {
        // eslint-disable-next-line no-await-in-loop -- pages in order
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw new Error(`Auth user list failed: ${error.message}`)
        const match = data.users.find((user) => user.email?.toLowerCase() === email)
        if (match) {
          // eslint-disable-next-line no-await-in-loop -- one delete
          const deleted = await admin.auth.admin.deleteUser(match.id)
          if (deleted.error && deleted.error.status !== 404)
            throw new Error(`Auth user delete failed: ${deleted.error.message}`)
          return
        }
        if (data.users.length < 1000) return
      }
    },
  }
}
