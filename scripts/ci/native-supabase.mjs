#!/usr/bin/env node
/**
 * The iOS share-card lane's local Supabase, run as native processes on the macOS
 * runner: PostgreSQL 17.6, Redis 7.4, GoTrue (supabase/auth v2.183.0),
 * storage-api (supabase/storage v1.32.0) and a Node gateway in place of Kong
 * (native-supabase-gateway.mjs). Every component is built from a pinned upstream
 * source and cached by the workflow under the key `cache-keys` prints.
 *
 *   node scripts/ci/native-supabase.mjs cache-keys      # <name>-key= and <name>-path= lines
 *   node scripts/ci/native-supabase.mjs build postgres  # also: redis, gotrue, storage
 *   node scripts/ci/native-supabase.mjs fetch gotrue    # the source, so setup-go can read go.mod
 *   node scripts/ci/native-supabase.mjs start           # start, migrate, export the environment
 *   node scripts/ci/native-supabase.mjs logs            # the tail of every service log
 *   node scripts/ci/native-supabase.mjs stop            # stop exactly the processes `start` recorded
 *
 * `start` exports what `.github/actions/start-local-supabase` exports
 * (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) plus REDIS_URL, to
 * $GITHUB_ENV. The keys are HS256 JWTs with the claims the Supabase CLI v2.62.5
 * signs, under a JWT secret generated for this run that never leaves the runtime.
 *
 * The root directory is $NATIVE_SUPABASE_ROOT, else $RUNNER_TEMP/native-supabase.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The pinned upstream of every component. A cache key covers its whole entry, so
 * any change to a version, checksum or build flag builds afresh.
 */
export const PINS = {
  postgres: {
    version: '17.6',
    url: 'https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.gz',
    // Published beside the tarball as postgresql-17.6.tar.gz.sha256; checked again at build.
    sha256: '2910b85283674da2dae6ac13fe5ebbaaf3c482446396cba32e6728d3cc736d86',
    configureFlags: ['--without-icu', '--without-readline'],
    contrib: ['pg_trgm'],
  },
  redis: {
    version: '7.4.12',
    url: 'https://download.redis.io/releases/redis-7.4.12.tar.gz',
    // From the official list, github.com/redis/redis-hashes; checked again at build.
    sha256: '56588ee1648539556f2b6cf4e873e3734afbbe40fa952fec2fcd6b6d7dae2924',
    hashesUrl: 'https://raw.githubusercontent.com/redis/redis-hashes/master/README',
    makeFlags: ['BUILD_TLS=no'],
  },
  gotrue: {
    repository: 'https://github.com/supabase/auth.git',
    tag: 'v2.183.0',
    commit: '7345c01537020a4277488e1b28b51664b37f3d26',
    // The upstream Makefile's build flags.
    ldflags: '-X github.com/supabase/auth/internal/utilities.Version=v2.183.0',
  },
  storage: {
    repository: 'https://github.com/supabase/storage.git',
    tag: 'v1.32.0',
    commit: 'c9a912adf20962ad50855336658cab301cdb0cbc',
    // The upstream Dockerfile runs on node:22-alpine.
    nodeMajor: 22,
  },
}

/** Fixed loopback ports: the scripts hardcode the database and API URLs. */
export const PORTS = { gateway: 54321, postgres: 54322, gotrue: 9999, storage: 5000 }

const COMPONENTS = /** @type {const} */ (['postgres', 'redis', 'gotrue', 'storage'])
const SERVICES = /** @type {const} */ (['gateway', 'storage', 'gotrue', 'redis'])

/** @param {NodeJS.ProcessEnv} env */
export function nativeRoot(env) {
  return (
    env.NATIVE_SUPABASE_ROOT ||
    path.join(env.RUNNER_TEMP || os.tmpdir(), 'native-supabase')
  )
}

/**
 * The `<name>-key=` and `<name>-path=` output lines for each component's cache.
 *
 * @param {{ root: string, platform: string, arch: string }} options
 */
export function cacheOutputs({ root, platform, arch }) {
  return COMPONENTS.flatMap((name) => {
    const pin = PINS[name]
    const recipe = createHash('sha256').update(JSON.stringify(pin)).digest('hex')
    const version = 'version' in pin ? pin.version : pin.tag
    return [
      `${name}-key=native-supabase-${platform}-${arch}-${name}-${version}-${recipe.slice(0, 16)}`,
      `${name}-path=${path.join(root, name)}`,
    ]
  })
}

/**
 * The hash a `<file>.sha256` file from ftp.postgresql.org states for `fileName`.
 *
 * @param {string} text
 * @param {string} fileName
 */
export function hashFromSha256File(text, fileName) {
  for (const line of text.split(/\r?\n/)) {
    const [hash, name] = line.trim().split(/\s+/)
    if (name?.replace(/^\*/, '') === fileName && /^[a-f0-9]{64}$/.test(hash)) return hash
  }
  throw new Error(`No SHA-256 for ${fileName} in the published checksum file.`)
}

/**
 * The hash the redis-hashes README lists for `fileName`
 * (`hash <file> sha256 <hash> <url>`).
 *
 * @param {string} text
 * @param {string} fileName
 */
export function hashFromRedisHashes(text, fileName) {
  for (const line of text.split(/\r?\n/)) {
    const [word, name, algorithm, hash] = line.trim().split(/\s+/)
    if (word === 'hash' && name === fileName && algorithm === 'sha256') return hash
  }
  throw new Error(`No SHA-256 for ${fileName} in the redis-hashes list.`)
}

/** @param {Buffer | string} value */
const base64url = (value) => Buffer.from(value).toString('base64url')

/**
 * An HS256 JWT over `claims`, serialized in the given key order.
 *
 * @param {Record<string, unknown>} claims
 * @param {string} secret
 */
export function signJwt(claims, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify(claims))
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  return `${header}.${payload}.${base64url(signature)}`
}

/**
 * The API keys the Supabase CLI v2.62.5 generates (pkg/config/apikeys.go): HS256
 * JWTs claiming `iss: supabase-demo`, the role and its default expiry, plus the
 * opaque publishable and secret keys the gateway maps to them.
 *
 * @param {string} jwtSecret
 * @param {(size: number) => Buffer} [random]
 */
export function apiKeys(jwtSecret, random = randomBytes) {
  const sign = (/** @type {string} */ role) =>
    signJwt({ iss: 'supabase-demo', role, exp: 1983812996 }, jwtSecret)
  return {
    anonKey: sign('anon'),
    serviceRoleKey: sign('service_role'),
    publishableKey: `sb_publishable_${random(16).toString('base64url')}`,
    secretKey: `sb_secret_${random(16).toString('base64url')}`,
  }
}

const apiExternalUrl = `http://127.0.0.1:${PORTS.gateway}`
const jwtIssuer = `${apiExternalUrl}/auth/v1`
const databaseUrl = (/** @type {string} */ user) =>
  `postgresql://${user}:postgres@127.0.0.1:${PORTS.postgres}/postgres`

/**
 * GoTrue's environment: the Supabase CLI v2.62.5 start.go values for this repo's
 * supabase/config.toml, with the host and paths of a native process. Mail goes
 * to an SMTP port nothing listens on, as on the Linux lanes, which exclude Mailpit.
 *
 * @param {{ jwtSecret: string, migrationsPath: string }} options
 */
export function gotrueEnv({ jwtSecret, migrationsPath }) {
  return {
    API_EXTERNAL_URL: apiExternalUrl,
    GOTRUE_API_HOST: '127.0.0.1',
    GOTRUE_API_PORT: String(PORTS.gotrue),
    GOTRUE_DB_DRIVER: 'postgres',
    GOTRUE_DB_DATABASE_URL: databaseUrl('supabase_auth_admin'),
    GOTRUE_DB_MIGRATIONS_PATH: migrationsPath,
    GOTRUE_SITE_URL: 'http://127.0.0.1:3000',
    GOTRUE_URI_ALLOW_LIST: 'https://127.0.0.1:3000',
    GOTRUE_DISABLE_SIGNUP: 'false',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_JWT_EXP: '3600',
    GOTRUE_JWT_SECRET: jwtSecret,
    GOTRUE_JWT_ISSUER: jwtIssuer,
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_MAILER_OTP_LENGTH: '6',
    GOTRUE_MAILER_OTP_EXP: '3600',
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
    GOTRUE_SMTP_MAX_FREQUENCY: '1s',
    GOTRUE_MAILER_URLPATHS_INVITE: `${jwtIssuer}/verify`,
    GOTRUE_MAILER_URLPATHS_CONFIRMATION: `${jwtIssuer}/verify`,
    GOTRUE_MAILER_URLPATHS_RECOVERY: `${jwtIssuer}/verify`,
    GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: `${jwtIssuer}/verify`,
    GOTRUE_RATE_LIMIT_EMAIL_SENT: '360000',
    GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
    GOTRUE_SMS_AUTOCONFIRM: 'true',
    GOTRUE_SMS_MAX_FREQUENCY: '5s',
    GOTRUE_SMS_OTP_EXP: '6000',
    GOTRUE_SMS_OTP_LENGTH: '6',
    GOTRUE_SMS_TEMPLATE: 'Your code is {{ .Code }}',
    GOTRUE_SMS_TEST_OTP: '',
    GOTRUE_PASSWORD_MIN_LENGTH: '6',
    GOTRUE_PASSWORD_REQUIRED_CHARACTERS: '',
    GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true',
    GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '10',
    GOTRUE_SECURITY_MANUAL_LINKING_ENABLED: 'false',
    GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION: 'false',
    GOTRUE_MFA_PHONE_ENROLL_ENABLED: 'false',
    GOTRUE_MFA_PHONE_VERIFY_ENABLED: 'false',
    GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'false',
    GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'false',
    GOTRUE_MFA_WEB_AUTHN_ENROLL_ENABLED: 'false',
    GOTRUE_MFA_WEB_AUTHN_VERIFY_ENABLED: 'false',
    GOTRUE_MFA_MAX_ENROLLED_FACTORS: '10',
    GOTRUE_RATE_LIMIT_ANONYMOUS_USERS: '30',
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '150',
    GOTRUE_RATE_LIMIT_OTP: '30',
    GOTRUE_RATE_LIMIT_VERIFY: '30',
    GOTRUE_RATE_LIMIT_SMS_SENT: '30',
    GOTRUE_RATE_LIMIT_WEB3: '30',
    GOTRUE_SMTP_HOST: '127.0.0.1',
    GOTRUE_SMTP_PORT: '1025',
    GOTRUE_SMTP_ADMIN_EMAIL: 'admin@email.com',
    GOTRUE_SMTP_SENDER_NAME: 'Admin',
    GOTRUE_EXTERNAL_APPLE_ENABLED: 'false',
    GOTRUE_EXTERNAL_APPLE_CLIENT_ID: '',
    GOTRUE_EXTERNAL_APPLE_SECRET: '',
    GOTRUE_EXTERNAL_APPLE_SKIP_NONCE_CHECK: 'false',
    GOTRUE_EXTERNAL_APPLE_EMAIL_OPTIONAL: 'false',
    GOTRUE_EXTERNAL_APPLE_REDIRECT_URI: `${jwtIssuer}/callback`,
    GOTRUE_EXTERNAL_WEB3_SOLANA_ENABLED: 'false',
  }
}

/**
 * storage-api's environment: the Supabase CLI v2.62.5 start.go values, single
 * tenant on the file backend, listening on loopback.
 *
 * @param {{ jwtSecret: string, anonKey: string, serviceRoleKey: string, filesPath: string, s3AccessKeyId: string, s3SecretAccessKey: string }} options
 */
export function storageEnv(options) {
  const jwks = JSON.stringify({
    keys: [{ kty: 'oct', k: Buffer.from(options.jwtSecret).toString('base64url') }],
  })
  return {
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: String(PORTS.storage),
    ANON_KEY: options.anonKey,
    SERVICE_KEY: options.serviceRoleKey,
    AUTH_JWT_SECRET: options.jwtSecret,
    JWT_JWKS: jwks,
    DATABASE_URL: databaseUrl('supabase_storage_admin'),
    // supabase/config.toml: file_size_limit = "50MiB".
    FILE_SIZE_LIMIT: String(50 * 1024 * 1024),
    STORAGE_BACKEND: 'file',
    FILE_STORAGE_BACKEND_PATH: options.filesPath,
    TENANT_ID: 'stub',
    STORAGE_S3_REGION: 'local',
    GLOBAL_S3_BUCKET: 'stub',
    ENABLE_IMAGE_TRANSFORMATION: 'false',
    TUS_URL_PATH: '/storage/v1/upload/resumable',
    S3_PROTOCOL_ACCESS_KEY_ID: options.s3AccessKeyId,
    S3_PROTOCOL_ACCESS_KEY_SECRET: options.s3SecretAccessKey,
    S3_PROTOCOL_PREFIX: '/storage/v1',
    UPLOAD_FILE_SIZE_LIMIT: '52428800000',
    UPLOAD_FILE_SIZE_LIMIT_STANDARD: '5242880000',
    SIGNED_UPLOAD_URL_EXPIRATION_TIME: '7200',
  }
}

/**
 * The lines `start` appends to $GITHUB_ENV: the composite action's three plus
 * REDIS_URL.
 *
 * @param {{ anonKey: string, serviceRoleKey: string, redisPort: number }} options
 */
export function exportedEnvironment({ anonKey, serviceRoleKey, redisPort }) {
  return [
    `SUPABASE_URL=${apiExternalUrl}`,
    `SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
    `REDIS_URL=redis://127.0.0.1:${redisPort}`,
  ]
}

/** @param {string} root */
const paths = (root) => ({
  postgres: path.join(root, 'postgres'),
  redis: path.join(root, 'redis'),
  gotrue: path.join(root, 'gotrue'),
  storage: path.join(root, 'storage'),
  sources: path.join(root, 'sources'),
  runtime: path.join(root, 'runtime'),
})

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} ${args.slice(0, 2).join(' ')} failed (exit ${result.status ?? result.signal}).`
    )
  return result
}

/** @param {string} file */
const sha256File = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** @param {string} url */
function fetchText(url) {
  return run('curl', ['-fsSL', '--retry', '3', url], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).stdout.toString()
}

/**
 * Downloads `url` into a fresh directory and returns the file once its SHA-256
 * equals the pinned one.
 *
 * @param {string} url
 * @param {string} expected
 * @param {string} directory
 */
function downloadVerified(url, expected, directory) {
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, path.basename(new URL(url).pathname))
  run('curl', ['-fsSL', '--retry', '3', '-o', file, url])
  const actual = sha256File(file)
  if (actual !== expected)
    throw new Error(
      `${path.basename(file)} has SHA-256 ${actual}; ${expected} is pinned.`
    )
  return file
}

/** @param {string} root */
function freshSources(root, name) {
  const directory = path.join(paths(root).sources, name)
  fs.rmSync(directory, { recursive: true, force: true })
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

const jobs = String(Math.max(2, os.availableParallelism()))

/** @param {string} root */
function buildPostgres(root) {
  const pin = PINS.postgres
  const fileName = path.basename(new URL(pin.url).pathname)
  const published = hashFromSha256File(fetchText(`${pin.url}.sha256`), fileName)
  if (published !== pin.sha256)
    throw new Error(
      `ftp.postgresql.org publishes ${published} for ${fileName}; ${pin.sha256} is pinned.`
    )
  const directory = freshSources(root, 'postgres')
  const tarball = downloadVerified(pin.url, pin.sha256, directory)
  run('tar', ['-xzf', tarball, '-C', directory])
  const source = path.join(directory, `postgresql-${pin.version}`)
  const prefix = paths(root).postgres
  fs.rmSync(prefix, { recursive: true, force: true })
  run('./configure', [`--prefix=${prefix}`, ...pin.configureFlags], { cwd: source })
  run('make', ['-j', jobs], { cwd: source })
  run('make', ['install'], { cwd: source })
  for (const module of pin.contrib)
    run('make', ['-C', `contrib/${module}`, '-j', jobs, 'install'], { cwd: source })
  fs.rmSync(directory, { recursive: true, force: true })
}

/** @param {string} root */
function buildRedis(root) {
  const pin = PINS.redis
  const fileName = path.basename(new URL(pin.url).pathname)
  const listed = hashFromRedisHashes(fetchText(pin.hashesUrl), fileName)
  if (listed !== pin.sha256)
    throw new Error(
      `redis-hashes lists ${listed} for ${fileName}; ${pin.sha256} is pinned.`
    )
  const directory = freshSources(root, 'redis')
  const tarball = downloadVerified(pin.url, pin.sha256, directory)
  run('tar', ['-xzf', tarball, '-C', directory])
  const source = path.join(directory, `redis-${pin.version}`)
  run('make', ['-j', jobs, ...pin.makeFlags], { cwd: source })
  const bin = path.join(paths(root).redis, 'bin')
  fs.rmSync(paths(root).redis, { recursive: true, force: true })
  fs.mkdirSync(bin, { recursive: true })
  for (const binary of ['redis-server', 'redis-cli'])
    fs.copyFileSync(path.join(source, 'src', binary), path.join(bin, binary))
  for (const binary of ['redis-server', 'redis-cli'])
    fs.chmodSync(path.join(bin, binary), 0o755)
  fs.rmSync(directory, { recursive: true, force: true })
}

/**
 * A shallow clone of `tag`, refused unless it is the pinned commit.
 *
 * @param {{ repository: string, tag: string, commit: string }} pin
 * @param {string} directory
 */
function cloneAtTag(pin, directory) {
  fs.rmSync(directory, { recursive: true, force: true })
  run('git', [
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--branch',
    pin.tag,
    pin.repository,
    directory,
  ])
  const head = run('git', ['-C', directory, 'rev-parse', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  })
    .stdout.toString()
    .trim()
  if (head !== pin.commit)
    throw new Error(`${pin.repository} ${pin.tag} is ${head}; ${pin.commit} is pinned.`)
}

/** @param {string} root */
const gotrueSource = (root) => path.join(paths(root).sources, 'auth')

/** @param {string} root */
function fetchGotrue(root) {
  cloneAtTag(PINS.gotrue, gotrueSource(root))
}

/** @param {string} root */
function buildGotrue(root) {
  const source = gotrueSource(root)
  if (!fs.existsSync(path.join(source, 'go.mod'))) fetchGotrue(root)
  const install = paths(root).gotrue
  fs.rmSync(install, { recursive: true, force: true })
  fs.mkdirSync(install, { recursive: true })
  run(
    'go',
    [
      'build',
      '-ldflags',
      PINS.gotrue.ldflags,
      '-buildvcs=false',
      '-o',
      path.join(install, 'auth'),
    ],
    { cwd: source, env: { ...process.env, CGO_ENABLED: '0' } }
  )
  fs.cpSync(path.join(source, 'migrations'), path.join(install, 'migrations'), {
    recursive: true,
  })
  fs.rmSync(source, { recursive: true, force: true })
}

/**
 * The Node binary storage-api runs on: $NATIVE_SUPABASE_NODE, refused unless it
 * is the pinned major.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function storageNode(env) {
  const node = env.NATIVE_SUPABASE_NODE
  if (!node)
    throw new Error('NATIVE_SUPABASE_NODE must name the Node binary for storage-api.')
  const version = run(node, ['--version'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  })
    .stdout.toString()
    .trim()
  if (!version.startsWith(`v${PINS.storage.nodeMajor}.`))
    throw new Error(
      `storage-api needs Node ${PINS.storage.nodeMajor}; ${node} is ${version}.`
    )
  return node
}

/** @param {string} node */
const withNodeOnPath = (node) => ({
  ...process.env,
  PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ''}`,
})

/**
 * Builds storage-api the way its Dockerfile does: `npm ci`, `npm run build`, then
 * production dependencies only, leaving `dist/` beside `migrations/`.
 *
 * @param {string} root
 */
function buildStorage(root) {
  const node = storageNode(process.env)
  const install = paths(root).storage
  cloneAtTag(PINS.storage, install)
  const env = withNodeOnPath(node)
  run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: install, env })
  run('npm', ['run', 'build'], { cwd: install, env })
  run('npm', ['prune', '--omit=dev', '--no-audit', '--no-fund'], { cwd: install, env })
  fs.rmSync(path.join(install, '.git'), { recursive: true, force: true })
}

/**
 * Fails, naming the holder, when a fixed port is already taken.
 *
 * @param {number} port
 */
async function assertPortFree(port) {
  const free = await new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
  if (free) return
  const holder = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  }).stdout
  throw new Error(`Port ${port} is already in use:\n${holder}`)
}

/** A loopback port no one holds right now. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (server.address())
      server.close(() => resolve(port))
    })
  })
}

/**
 * Starts a service that outlives this process, its output in `log`.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ log: string, env?: NodeJS.ProcessEnv, cwd?: string }} options
 */
function startService(command, args, { log, env, cwd }) {
  const output = fs.openSync(log, 'a', 0o600)
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', output, output],
  })
  fs.closeSync(output)
  /** @type {{ code: number | null, signal: string | null } | null} */
  let exited = null
  child.on('exit', (code, signal) => {
    exited = { code, signal }
  })
  child.unref()
  if (!child.pid) throw new Error(`${command} did not start.`)
  return { pid: child.pid, exited: () => exited }
}

/**
 * The last lines of a log, for a failure message.
 *
 * @param {string} log
 */
function tail(log, lines = 60) {
  if (!fs.existsSync(log)) return '(no log)'
  return fs.readFileSync(log, 'utf8').split('\n').slice(-lines).join('\n')
}

/**
 * Polls `ready` until it holds, the service exits or `seconds` pass.
 *
 * @param {string} label
 * @param {() => Promise<boolean>} ready
 * @param {{ seconds: number, log: string, exited?: () => unknown }} options
 */
async function waitFor(label, ready, { seconds, log, exited }) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    const gone = exited?.()
    if (gone)
      throw new Error(
        `${label} exited (${JSON.stringify(gone)}) before it was ready:\n${tail(log)}`
      )
    if (await ready().catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${label} was not ready within ${seconds}s:\n${tail(log)}`)
}

/**
 * @param {string} url
 * @param {Record<string, string>} [headers]
 */
const answers200 =
  (url, headers = {}) =>
  async () =>
    (await fetch(url, { headers, signal: AbortSignal.timeout(2000) })).status === 200

/** @param {number} port */
const redisPongs = (port) => () =>
  new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    let reply = ''
    socket.setTimeout(2000, () => socket.destroy())
    socket.on('connect', () => socket.write('PING\r\n'))
    socket.on('data', (chunk) => {
      reply += chunk
      if (reply.includes('\r\n')) socket.end()
    })
    socket.on('close', () => resolve(reply.startsWith('+PONG')))
    socket.on('error', () => resolve(false))
  })

/** @param {string} runtime */
const statePath = (runtime) => path.join(runtime, 'state.json')

/**
 * @param {string} runtime
 * @param {Record<string, unknown>} state
 */
function writeState(runtime, state) {
  fs.writeFileSync(statePath(runtime), `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  })
}

/** @param {string} root */
async function start(root) {
  const where = paths(root)
  const node = storageNode(process.env)
  for (const name of COMPONENTS)
    if (!fs.existsSync(where[name]))
      throw new Error(`${name} is not built at ${where[name]}.`)
  if (fs.existsSync(where.runtime))
    throw new Error(
      `${where.runtime} exists: a native stack already ran here; stop it first.`
    )
  for (const port of Object.values(PORTS)) await assertPortFree(port)

  const runtime = where.runtime
  const logs = path.join(runtime, 'logs')
  const socketDirectory = path.join(runtime, 'run')
  const dataDirectory = path.join(runtime, 'data')
  const filesDirectory = path.join(runtime, 'files')
  for (const directory of [logs, socketDirectory, filesDirectory])
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const log = (/** @type {string} */ name) => path.join(logs, `${name}.log`)
  /** @type {{ startedAt: string, dataDirectory: string, pids: Record<string, number> }} */
  const state = { startedAt: new Date().toISOString(), dataDirectory, pids: {} }
  writeState(runtime, state)
  /** @type {Record<string, number>} */
  const timings = {}
  const began = Date.now()
  const timed = async (
    /** @type {string} */ label,
    /** @type {() => Promise<void> | void} */ step
  ) => {
    const at = Date.now()
    await step()
    timings[label] = Math.round((Date.now() - at) / 100) / 10
  }

  const jwtSecret = randomBytes(32).toString('hex')
  const keys = apiKeys(jwtSecret)
  const pgBin = (/** @type {string} */ name) => path.join(where.postgres, 'bin', name)

  await timed('postgres', async () => {
    run(
      pgBin('initdb'),
      [
        '--pgdata',
        dataDirectory,
        '--username',
        'supabase_admin',
        '--encoding',
        'UTF8',
        '--locale',
        'en_US.UTF-8',
        '--auth-local',
        'trust',
        '--auth-host',
        'scram-sha-256',
        '--no-instructions',
      ],
      {
        stdio: [
          'ignore',
          fs.openSync(log('initdb'), 'a'),
          fs.openSync(log('initdb'), 'a'),
        ],
      }
    )
    run(
      pgBin('pg_ctl'),
      [
        '--pgdata',
        dataDirectory,
        '--log',
        log('postgres'),
        '--wait',
        '--timeout',
        '60',
        '-o',
        `-c listen_addresses=127.0.0.1 -c port=${PORTS.postgres} -c unix_socket_directories=${socketDirectory} -c shared_buffers=32MB -c work_mem=2MB -c maintenance_work_mem=16MB -c max_connections=40`,
        'start',
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] }
    )
    state.pids.postgres = Number(
      fs.readFileSync(path.join(dataDirectory, 'postmaster.pid'), 'utf8').split('\n')[0]
    )
    writeState(runtime, state)
    run(pgBin('psql'), [
      '--no-psqlrc',
      '--quiet',
      '--host',
      socketDirectory,
      '--port',
      String(PORTS.postgres),
      '--username',
      'supabase_admin',
      '--dbname',
      'postgres',
      '--file',
      path.join(repoRoot, 'scripts/ci/native-supabase-bootstrap.sql'),
    ])
  })

  let redisPort = 0
  await timed('redis', async () => {
    redisPort = await freePort()
    const redis = startService(
      path.join(where.redis, 'bin', 'redis-server'),
      [
        '--bind',
        '127.0.0.1',
        '--port',
        String(redisPort),
        '--save',
        '',
        '--appendonly',
        'no',
        '--dir',
        runtime,
      ],
      { log: log('redis') }
    )
    state.pids.redis = redis.pid
    writeState(runtime, state)
    await waitFor('Redis', redisPongs(redisPort), {
      seconds: 30,
      log: log('redis'),
      exited: redis.exited,
    })
  })

  await timed('gotrue', async () => {
    // With no command GoTrue runs its migrations, then serves.
    const gotrue = startService(path.join(where.gotrue, 'auth'), [], {
      log: log('gotrue'),
      cwd: where.gotrue,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...gotrueEnv({
          jwtSecret,
          migrationsPath: path.join(where.gotrue, 'migrations'),
        }),
      },
    })
    state.pids.gotrue = gotrue.pid
    writeState(runtime, state)
    await waitFor('GoTrue', answers200(`http://127.0.0.1:${PORTS.gotrue}/health`), {
      seconds: 120,
      log: log('gotrue'),
      exited: gotrue.exited,
    })
  })

  await timed('storage', async () => {
    // Single tenant, storage-api migrates its schema before it listens.
    const storage = startService(node, ['dist/start/server.js'], {
      log: log('storage'),
      cwd: where.storage,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'production',
        ...storageEnv({
          jwtSecret,
          anonKey: keys.anonKey,
          serviceRoleKey: keys.serviceRoleKey,
          filesPath: filesDirectory,
          s3AccessKeyId: randomBytes(16).toString('hex'),
          s3SecretAccessKey: randomBytes(32).toString('hex'),
        }),
      },
    })
    state.pids.storage = storage.pid
    writeState(runtime, state)
    await waitFor('storage-api', answers200(`http://127.0.0.1:${PORTS.storage}/status`), {
      seconds: 180,
      log: log('storage'),
      exited: storage.exited,
    })
  })

  await timed('gateway', async () => {
    const gateway = startService(
      process.execPath,
      [path.join(repoRoot, 'scripts/ci/native-supabase-gateway.mjs')],
      {
        log: log('gateway'),
        env: {
          PATH: process.env.PATH,
          NATIVE_GATEWAY_PORT: String(PORTS.gateway),
          NATIVE_GATEWAY_GOTRUE_URL: `http://127.0.0.1:${PORTS.gotrue}`,
          NATIVE_GATEWAY_STORAGE_URL: `http://127.0.0.1:${PORTS.storage}`,
          NATIVE_GATEWAY_ANON_KEY: keys.anonKey,
          NATIVE_GATEWAY_SERVICE_ROLE_KEY: keys.serviceRoleKey,
          NATIVE_GATEWAY_PUBLISHABLE_KEY: keys.publishableKey,
          NATIVE_GATEWAY_SECRET_KEY: keys.secretKey,
        },
      }
    )
    state.pids.gateway = gateway.pid
    writeState(runtime, state)
    const api = `http://127.0.0.1:${PORTS.gateway}`
    await waitFor(
      'gateway',
      answers200(`${api}/auth/v1/health`, { apikey: keys.anonKey }),
      {
        seconds: 30,
        log: log('gateway'),
        exited: gateway.exited,
      }
    )
    // Both upstreams answer through the gateway with the service-role key.
    const service = {
      apikey: keys.serviceRoleKey,
      authorization: `Bearer ${keys.serviceRoleKey}`,
    }
    await waitFor(
      'GoTrue admin through the gateway',
      answers200(`${api}/auth/v1/admin/users`, service),
      {
        seconds: 10,
        log: log('gotrue'),
      }
    )
    await waitFor(
      'storage-api through the gateway',
      answers200(`${api}/storage/v1/bucket`, service),
      {
        seconds: 10,
        log: log('storage'),
      }
    )
  })
  timings.total = Math.round((Date.now() - began) / 100) / 10

  const exported = exportedEnvironment({ ...keys, redisPort }).join('\n') + '\n'
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, exported)
  else fs.writeFileSync(path.join(runtime, 'env'), exported, { mode: 0o600 })
  console.log(JSON.stringify({ status: 'ready', seconds: timings, pids: state.pids }))
}

/**
 * @param {number} pid
 */
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** @param {string} root */
async function stop(root) {
  const runtime = paths(root).runtime
  if (!fs.existsSync(statePath(runtime))) {
    console.log('No native stack state; nothing to stop.')
    return
  }
  const state = JSON.parse(fs.readFileSync(statePath(runtime), 'utf8'))
  for (const name of SERVICES) {
    const pid = state.pids?.[name]
    if (!Number.isInteger(pid) || !alive(pid)) continue
    process.kill(pid, 'SIGTERM')
    const deadline = Date.now() + 15_000
    while (alive(pid) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 250))
    if (alive(pid)) process.kill(pid, 'SIGKILL')
  }
  if (
    state.pids?.postgres &&
    fs.existsSync(path.join(state.dataDirectory, 'postmaster.pid'))
  ) {
    run(path.join(paths(root).postgres, 'bin', 'pg_ctl'), [
      '--pgdata',
      state.dataDirectory,
      '--mode',
      'fast',
      '--wait',
      'stop',
    ])
  }
  writeState(runtime, { ...state, stoppedAt: new Date().toISOString() })
  console.log(`Stopped the native stack (${Object.keys(state.pids ?? {}).join(', ')}).`)
}

/** @param {string} root */
function logs(root) {
  const directory = path.join(paths(root).runtime, 'logs')
  if (!fs.existsSync(directory)) return
  for (const file of fs.readdirSync(directory).sort()) {
    console.log(`::group::${file}`)
    console.log(tail(path.join(directory, file), 120))
    console.log('::endgroup::')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, component] = process.argv.slice(2)
  const root = nativeRoot(process.env)
  const builds = {
    postgres: buildPostgres,
    redis: buildRedis,
    gotrue: buildGotrue,
    storage: buildStorage,
  }
  if (command === 'cache-keys') {
    console.log(
      cacheOutputs({ root, platform: process.platform, arch: process.arch }).join('\n')
    )
  } else if (command === 'build' && component in builds) {
    const began = Date.now()
    builds[/** @type {keyof typeof builds} */ (component)](root)
    console.log(`Built ${component} in ${Math.round((Date.now() - began) / 1000)}s.`)
  } else if (command === 'fetch' && component === 'gotrue') {
    fetchGotrue(root)
  } else if (command === 'start') {
    await start(root)
  } else if (command === 'stop') {
    await stop(root)
  } else if (command === 'logs') {
    logs(root)
  } else {
    console.error(
      'Usage: native-supabase.mjs cache-keys | build <postgres|redis|gotrue|storage> | fetch gotrue | start | logs | stop'
    )
    process.exit(2)
  }
}
