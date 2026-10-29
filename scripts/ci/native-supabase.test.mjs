import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  PINS,
  PORTS,
  apiKeys,
  cacheOutputs,
  exportedEnvironment,
  gotrueEnv,
  hashFromRedisHashes,
  hashFromSha256File,
  nativeRoot,
  redactLogText,
  signJwt,
  storageEnv,
} from './native-supabase.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** @param {string} token */
function decode(token) {
  const [header, payload, signature] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
    signed: `${header}.${payload}`,
    signature,
  }
}

test('HS256 tokens verify against the secret and keep the claim order', () => {
  const token = signJwt({ iss: 'supabase-demo', role: 'anon', exp: 1983812996 }, 'secret')
  const { header, payload, signed, signature } = decode(token)
  assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' })
  assert.deepEqual(Object.keys(payload), ['iss', 'role', 'exp'])
  assert.equal(
    signature,
    createHmac('sha256', 'secret').update(signed).digest('base64url')
  )
})

test('API keys carry the CLI claims, one role each, under one secret', () => {
  const secret = 'a'.repeat(64)
  const keys = apiKeys(secret, (size) => Buffer.alloc(size, 1))
  for (const [key, role] of [
    [keys.anonKey, 'anon'],
    [keys.serviceRoleKey, 'service_role'],
  ]) {
    const { payload, signed, signature } = decode(key)
    assert.deepEqual(payload, { iss: 'supabase-demo', role, exp: 1983812996 })
    assert.equal(
      signature,
      createHmac('sha256', secret).update(signed).digest('base64url')
    )
  }
  assert.match(keys.publishableKey, /^sb_publishable_[A-Za-z0-9_-]{22}$/)
  assert.match(keys.secretKey, /^sb_secret_[A-Za-z0-9_-]{22}$/)
})

test('the lane exports the composite action variables plus REDIS_URL', () => {
  assert.deepEqual(
    exportedEnvironment({ anonKey: 'anon', serviceRoleKey: 'service', redisPort: 6400 }),
    [
      'SUPABASE_URL=http://127.0.0.1:54321',
      'SUPABASE_ANON_KEY=anon',
      'SUPABASE_SERVICE_ROLE_KEY=service',
      'REDIS_URL=redis://127.0.0.1:6400',
    ]
  )
})

test('the fixed ports are the ones the share-card scripts hardcode', async () => {
  assert.equal(PORTS.gateway, 54321)
  assert.equal(PORTS.postgres, 54322)
  const prepare = await readFile(
    path.join(root, 'scripts/e2e-share-card/prepare.mjs'),
    'utf8'
  )
  assert.match(prepare, /postgres:postgres@127\.0\.0\.1:54322\/postgres/)
})

test('GoTrue gets the CLI v2.62.5 values for this config.toml', async () => {
  const env = gotrueEnv({ jwtSecret: 'jwt-secret', migrationsPath: '/m' })
  const config = await readFile(path.join(root, 'supabase/config.toml'), 'utf8')
  // The values config.toml decides.
  assert.match(config, /^site_url = "http:\/\/127\.0\.0\.1:3000"$/m)
  assert.equal(env.GOTRUE_SITE_URL, 'http://127.0.0.1:3000')
  assert.match(config, /^jwt_expiry = 3600$/m)
  assert.equal(env.GOTRUE_JWT_EXP, '3600')
  assert.match(config, /^enable_confirmations = false$/m)
  assert.equal(env.GOTRUE_MAILER_AUTOCONFIRM, 'true')
  assert.match(config, /^otp_length = 6$/m)
  assert.equal(env.GOTRUE_MAILER_OTP_LENGTH, '6')
  assert.match(config, /^otp_expiry = 3600$/m)
  assert.equal(env.GOTRUE_MAILER_OTP_EXP, '3600')
  assert.match(config, /^refresh_token_reuse_interval = 10$/m)
  assert.equal(env.GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL, '10')
  assert.match(config, /^token_refresh = 150$/m)
  assert.equal(env.GOTRUE_RATE_LIMIT_TOKEN_REFRESH, '150')
  // The values start.go fixes.
  assert.equal(env.API_EXTERNAL_URL, 'http://127.0.0.1:54321')
  assert.equal(env.GOTRUE_JWT_ISSUER, 'http://127.0.0.1:54321/auth/v1')
  assert.equal(env.GOTRUE_JWT_ADMIN_ROLES, 'service_role')
  assert.equal(env.GOTRUE_JWT_AUD, 'authenticated')
  assert.equal(env.GOTRUE_JWT_SECRET, 'jwt-secret')
  assert.equal(env.GOTRUE_RATE_LIMIT_EMAIL_SENT, '360000')
  assert.equal(
    env.GOTRUE_DB_DATABASE_URL,
    'postgresql://supabase_auth_admin:postgres@127.0.0.1:54322/postgres'
  )
  assert.equal(env.GOTRUE_DB_MIGRATIONS_PATH, '/m')
  assert.equal(env.GOTRUE_API_HOST, '127.0.0.1')
  assert.equal(env.GOTRUE_API_PORT, '9999')
  // No asymmetric signing keys: config.toml sets no signing_keys_path.
  assert.doesNotMatch(config, /^signing_keys_path/m)
  assert.equal('GOTRUE_JWT_KEYS' in env, false)
})

test('storage-api runs single tenant on files with the CLI v2.62.5 values', () => {
  const env = storageEnv({
    jwtSecret: 'jwt-secret',
    anonKey: 'anon',
    serviceRoleKey: 'service',
    filesPath: '/files',
    s3AccessKeyId: 'id',
    s3SecretAccessKey: 'secret',
  })
  assert.equal(
    env.DATABASE_URL,
    'postgresql://supabase_storage_admin:postgres@127.0.0.1:54322/postgres'
  )
  assert.equal(env.STORAGE_BACKEND, 'file')
  assert.equal(env.FILE_STORAGE_BACKEND_PATH, '/files')
  assert.equal(env.FILE_SIZE_LIMIT, '52428800')
  assert.equal(env.TENANT_ID, 'stub')
  assert.equal(env.AUTH_JWT_SECRET, 'jwt-secret')
  assert.deepEqual(JSON.parse(env.JWT_JWKS), {
    keys: [{ kty: 'oct', k: Buffer.from('jwt-secret').toString('base64url') }],
  })
  assert.equal(env.ANON_KEY, 'anon')
  assert.equal(env.SERVICE_KEY, 'service')
  assert.equal(env.SERVER_HOST, '127.0.0.1')
  assert.equal(env.SERVER_PORT, '5000')
  assert.equal(env.TUS_URL_PATH, '/storage/v1/upload/resumable')
  assert.equal('MULTI_TENANT' in env, false)
})

test('cache keys follow every pinned input and name the install paths', () => {
  const lines = cacheOutputs({ root: '/r', platform: 'darwin', arch: 'x64' })
  const outputs = Object.fromEntries(
    lines.map((line) => line.split(/=(.*)/s).slice(0, 2))
  )
  assert.match(
    outputs['postgres-key'],
    /^native-supabase-darwin-x64-postgres-17\.6-[a-f0-9]{16}$/
  )
  assert.match(
    outputs['redis-key'],
    /^native-supabase-darwin-x64-redis-7\.4\.12-[a-f0-9]{16}$/
  )
  assert.match(
    outputs['gotrue-key'],
    /^native-supabase-darwin-x64-gotrue-v2\.183\.0-[a-f0-9]{16}$/
  )
  assert.match(
    outputs['storage-key'],
    /^native-supabase-darwin-x64-storage-v1\.32\.0-[a-f0-9]{16}$/
  )
  assert.equal(outputs['postgres-path'], path.join('/r', 'postgres'))
  assert.equal(outputs['storage-path'], path.join('/r', 'storage'))

  // The architecture is part of every key: an arm64 runner never restores x64 builds.
  const arm = cacheOutputs({ root: '/r', platform: 'darwin', arch: 'arm64' })
  for (const [index, line] of arm.entries())
    if (line.includes('-key=')) {
      assert.match(line, /=native-supabase-darwin-arm64-/)
      assert.notEqual(line, lines[index])
    }

  // A configure flag change is a different build, so a different key.
  const flags = PINS.postgres.configureFlags
  PINS.postgres.configureFlags = [...flags, '--with-zlib']
  try {
    const changed = cacheOutputs({ root: '/r', platform: 'darwin', arch: 'x64' })
    assert.notEqual(changed[0], lines[0])
    assert.equal(changed[2], lines[2])
  } finally {
    PINS.postgres.configureFlags = flags
  }
})

test('the pinned versions are the ones the lane is decided on', () => {
  assert.equal(PINS.postgres.version, '17.6')
  assert.ok(PINS.postgres.url.startsWith('https://ftp.postgresql.org/pub/source/v17.6/'))
  assert.deepEqual(PINS.postgres.contrib, ['pg_trgm'])
  assert.match(PINS.redis.version, /^7\.\d+\.\d+$/)
  assert.equal(PINS.gotrue.tag, 'v2.183.0')
  assert.equal(PINS.storage.tag, 'v1.32.0')
  assert.equal(PINS.storage.nodeMajor, 22)
})

test('the published Postgres checksum file is read for the exact tarball', () => {
  const hash = 'b'.repeat(64)
  assert.equal(
    hashFromSha256File(`${hash}  postgresql-17.6.tar.gz\n`, 'postgresql-17.6.tar.gz'),
    hash
  )
  assert.equal(
    hashFromSha256File(`${hash} *postgresql-17.6.tar.gz`, 'postgresql-17.6.tar.gz'),
    hash
  )
  assert.throws(
    () =>
      hashFromSha256File(`${hash}  postgresql-17.6.tar.bz2\n`, 'postgresql-17.6.tar.gz'),
    /No SHA-256/
  )
  assert.throws(
    () =>
      hashFromSha256File('not-a-hash  postgresql-17.6.tar.gz', 'postgresql-17.6.tar.gz'),
    /No SHA-256/
  )
})

test('the redis-hashes list is read for the exact release', () => {
  const list = [
    'hash redis-7.4.11.tar.gz sha256 aaaa http://download.redis.io/releases/redis-7.4.11.tar.gz',
    'hash redis-7.4.12.tar.gz sha256 bbbb http://download.redis.io/releases/redis-7.4.12.tar.gz',
  ].join('\n')
  assert.equal(hashFromRedisHashes(list, 'redis-7.4.12.tar.gz'), 'bbbb')
  assert.throws(() => hashFromRedisHashes(list, 'redis-7.4.13.tar.gz'), /No SHA-256/)
})

test('the root is the explicit one, else under the runner temp', () => {
  assert.equal(nativeRoot({ NATIVE_SUPABASE_ROOT: '/x' }), '/x')
  assert.equal(nativeRoot({ RUNNER_TEMP: '/t' }), path.join('/t', 'native-supabase'))
})

test('the bootstrap SQL provides exactly the parity roles, schemas and storage ledger', async () => {
  const sql = await readFile(
    path.join(root, 'scripts/ci/native-supabase-bootstrap.sql'),
    'utf8'
  )
  const statements = sql
    .split('\n')
    .filter((line) => !line.startsWith('--') && !line.startsWith('\\'))
    .join(' ')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  assert.deepEqual(statements, [
    'CREATE ROLE anon NOLOGIN',
    'CREATE ROLE authenticated NOLOGIN',
    'CREATE ROLE service_role NOLOGIN BYPASSRLS',
    'CREATE ROLE authenticator LOGIN NOINHERIT',
    'GRANT anon, authenticated, service_role TO authenticator',
    "CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE PASSWORD 'postgres'",
    'ALTER ROLE supabase_auth_admin SET search_path = auth',
    "CREATE ROLE supabase_storage_admin LOGIN NOINHERIT CREATEROLE PASSWORD 'postgres'",
    'ALTER ROLE supabase_storage_admin SET search_path = storage',
    'GRANT authenticator TO supabase_storage_admin',
    "CREATE ROLE postgres LOGIN PASSWORD 'postgres' NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS",
    'GRANT pg_signal_backend TO postgres',
    'CREATE SCHEMA auth',
    'GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin',
    'CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin',
    'GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role',
    'SET ROLE supabase_storage_admin',
    'CREATE TABLE storage.migrations ( id integer PRIMARY KEY, name varchar(100) UNIQUE NOT NULL, hash varchar(40) NOT NULL, executed_at timestamp DEFAULT current_timestamp )',
    'RESET ROLE',
  ])
})

test('the bootstrap pre-creates the storage-api v1.32.0 migration ledger as its owner', async () => {
  const sql = await readFile(
    path.join(root, 'scripts/ci/native-supabase-bootstrap.sql'),
    'utf8'
  )
  // storage-api v1.32.0 needs CREATE on the database when this table is missing
  // (supabase/storage#928, fixed by #968 after v1.32.0).
  assert.equal(PINS.storage.tag, 'v1.32.0')
  assert.match(sql, /supabase\/storage#928/)
  const ledger = sql.match(
    /SET ROLE supabase_storage_admin;\s*CREATE TABLE storage\.migrations \(([^;]+)\);\s*RESET ROLE;/
  )
  assert.ok(ledger, 'storage.migrations is created as supabase_storage_admin')
  assert.deepEqual(
    ledger[1].split(',').map((column) => column.trim().replace(/\s+/g, ' ')),
    [
      'id integer PRIMARY KEY',
      'name varchar(100) UNIQUE NOT NULL',
      'hash varchar(40) NOT NULL',
      'executed_at timestamp DEFAULT current_timestamp',
    ]
  )
})

test('service log text printed to the public job log carries no secret', () => {
  const jwtSecret = 'a'.repeat(63) + 'b'
  const keys = apiKeys(jwtSecret)
  const env = {
    SUPABASE_SERVICE_ROLE_KEY: keys.serviceRoleKey,
    SUPABASE_ANON_KEY: keys.anonKey,
    GOTRUE_JWT_SECRET: 'short-jwt',
    PATH: '/usr/bin',
    HOME: '/Users/runner',
  }
  const text = [
    `auth: jwt ${keys.serviceRoleKey} accepted`,
    `storage: secret ${jwtSecret} loaded`,
    'db: connect postgresql://owner:hunter2hunter2@127.0.0.1:54322/db',
    'app: GOTRUE_JWT_SECRET=short-jwt set',
    `s3: id ${'0123456789abcdef'.repeat(2)}`,
    'gotrue: listening on 127.0.0.1:9999 after 12 ms',
  ].join('\n')
  const out = redactLogText(text, env)
  for (const secret of [
    keys.serviceRoleKey,
    keys.anonKey,
    jwtSecret,
    'hunter2hunter2',
    'short-jwt',
    '0123456789abcdef0123456789abcdef',
  ])
    assert.equal(out.includes(secret), false, secret)
  assert.match(out, /gotrue: listening on 127\.0\.0\.1:9999 after 12 ms/)
  assert.match(out, /postgresql:\/\/owner:\[redacted\]@127\.0\.0\.1:54322\/db/)
})
