#!/usr/bin/env node
// Push rotated production secrets from the gitignored .env.prod to every place that holds them,
// then redeploy. Values are read from the env files and passed on stdin; nothing secret is printed.
//
//   node scripts/ops/rotate-secrets.mjs db redis analytics supabase [--redeploy]
//
// Before running, put the new values in .env.prod:
//   db         SUPABASE_DB_PROD_PW (DATABASE_URL and DIRECT_URL are rebuilt from it)
//   redis      REDIS_URL and UPSTASH_REDIS_REST_TOKEN (Upstash: database, Settings, Reset Credentials)
//   analytics  ANALYTICS_ID_SECRET (any 64-char hex: openssl rand -hex 32)
//   supabase   SUPABASE_SERVICE_ROLE_KEY (sb_secret_...) and SUPABASE_ANON_KEY plus
//              NEXT_PUBLIC_SUPABASE_ANON_KEY (sb_publishable_...), from Settings, API Keys
// .env.local must hold NORTHFLANK_API_TOKEN for the community worker.
//
// Where each secret lives:
//   Vercel couture-cast-api   DATABASE_URL, DIRECT_URL, REDIS_URL, UPSTASH_REDIS_REST_TOKEN,
//                             ANALYTICS_ID_SECRET, SUPABASE_* keys
//   Vercel couture-cast-web   REDIS_URL, UPSTASH_REDIS_REST_TOKEN, SUPABASE_* keys
//   GitHub secret             DATABASE_URL_PROD (the Prod E2E database URL)
//   Northflank worker         DATABASE_URL, REDIS_URL, ANALYTICS_ID_SECRET, SUPABASE_SERVICE_ROLE_KEY
//
// The worker uses the transaction pooler (6543, pgbouncer=true, connection_limit=3) and keeps the
// TLS parameters already on its URL. Vercel does not store NEXT_PUBLIC_* values as Sensitive.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCOPE = 'muratkeremozcans-projects'
const API = 'couture-cast-api'
const WEB = 'couture-cast-web'
const WORKER_ENV_URL =
  'https://api.northflank.com/v1/projects/couture-cast/services/community-worker/runtime-environment'
const PARTS = new Set(['db', 'redis', 'analytics', 'supabase'])

const args = process.argv.slice(2)
const redeploy = args.includes('--redeploy')
const parts = new Set(args.filter((a) => a !== '--redeploy'))
if (!parts.size || [...parts].some((p) => !PARTS.has(p))) {
  console.error(`usage: rotate-secrets.mjs ${[...PARTS].join(' ')} [--redeploy]`)
  process.exit(1)
}

function readEnv(file) {
  const env = {}
  for (const line of readFileSync(path.join(REPO, file), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

// The owner's login shell does not put the nvm-installed CLI on PATH, so look there too.
function findVercel() {
  const which = spawnSync('which', ['vercel'], { encoding: 'utf8' })
  if (which.status === 0) return which.stdout.trim()
  const nvm = path.join(homedir(), '.nvm/versions/node')
  for (const version of existsSync(nvm) ? readdirSync(nvm).sort().reverse() : []) {
    const candidate = path.join(nvm, version, 'bin/vercel')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('vercel CLI not found')
}

const prod = readEnv('.env.prod')
const local = readEnv('.env.local')
const vercelBin = findVercel()

// Every key a selected part reads must be set before anything remote is touched: a missing
// value would otherwise remove a Vercel variable or write the literal "undefined".
const REQUIRED = {
  db: ['SUPABASE_DB_PROD_PW', 'DATABASE_URL', 'DIRECT_URL'],
  redis: ['REDIS_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  analytics: ['ANALYTICS_ID_SECRET'],
  supabase: [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ],
}
const missing = [...parts].flatMap((part) => REQUIRED[part].filter((key) => !prod[key]))
if (!local.NORTHFLANK_API_TOKEN) missing.push('NORTHFLANK_API_TOKEN (.env.local)')
if (missing.length) {
  console.error(`missing values in .env.prod: ${missing.join(', ')}`)
  process.exit(1)
}

function vercelSet(project, name, value) {
  const base = ['--project', project, '--scope', SCOPE, '--non-interactive']
  // Remove first so a variable stored as Config can come back as a secret.
  const removed =
    spawnSync(vercelBin, ['env', 'rm', name, 'production', '--yes', ...base], {
      cwd: '/tmp',
    }).status === 0
  const kind = name.startsWith('NEXT_PUBLIC_') ? '--no-sensitive' : '--sensitive'
  const add = ['env', 'add', name, '-e', 'production', kind, '--force', '--yes', ...base]
  const result = spawnSync(vercelBin, add, {
    cwd: '/tmp',
    input: value,
    encoding: 'utf8',
  })
  if (result.status !== 0)
    throw new Error(
      removed
        ? `vercel ${project} ${name}: add failed after the old value was removed; production has no ${name} until this is rerun`
        : `vercel ${project} ${name}: add failed; the previous value is still in production`
    )
  console.log(`vercel ${project} ${name}: set`)
}

function ghSecret(name, value) {
  execFileSync('gh', ['secret', 'set', name], {
    cwd: REPO,
    input: value,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  console.log(`github secret ${name}: set`)
}

function withPassword(url, password) {
  return url.replace(/(\/\/[^:]+:)[^@]*@/, `$1${encodeURIComponent(password)}@`)
}

const northflankHeaders = { Authorization: `Bearer ${local.NORTHFLANK_API_TOKEN}` }

async function workerEnv() {
  const response = await fetch(WORKER_ENV_URL, { headers: northflankHeaders })
  if (!response.ok)
    throw new Error(
      `northflank: reading the worker environment returned HTTP ${response.status}`
    )
  return (await response.json()).data.runtimeEnvironment
}

// The POST replaces the whole environment, so stop if it changed since the first read.
async function northflank(updates, snapshot) {
  const headers = northflankHeaders
  const current = await workerEnv()
  if (JSON.stringify(current) !== JSON.stringify(snapshot))
    throw new Error(
      'northflank: the worker environment changed during the rotation; rerun'
    )
  if (updates.DATABASE_URL === null) {
    const [base, query = ''] = current.DATABASE_URL.split('?')
    const params = query
      .split('&')
      .filter((p) => p && !/^(pgbouncer|connection_limit)=/.test(p))
      .concat('pgbouncer=true', 'connection_limit=3')
    updates.DATABASE_URL = `${withPassword(base, prod.SUPABASE_DB_PROD_PW).replace(':5432/', ':6543/')}?${params.join('&')}`
  }
  const response = await fetch(WORKER_ENV_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtimeEnvironment: { ...current, ...updates } }),
  })
  if (!response.ok) throw new Error(`northflank: HTTP ${response.status}`)
  console.log(
    `northflank community-worker: set ${Object.keys(updates).sort().join(', ')}`
  )
}

// Check every destination before the first write, so a bad token cannot leave a partial rotation.
const ghAuth = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' })
if (parts.has('db') && ghAuth.status !== 0) throw new Error('gh is not authenticated')
const workerSnapshot = await workerEnv()

const worker = {}
if (parts.has('db')) {
  const runtime = withPassword(prod.DATABASE_URL, prod.SUPABASE_DB_PROD_PW)
  const direct = withPassword(prod.DIRECT_URL, prod.SUPABASE_DB_PROD_PW)
  if (
    !runtime.includes(':6543/') ||
    !runtime.includes('pgbouncer=true') ||
    !direct.includes(':5432/')
  )
    throw new Error(
      '.env.prod DATABASE_URL must be the 6543 pgbouncer URL and DIRECT_URL the 5432 URL'
    )
  vercelSet(API, 'DATABASE_URL', runtime)
  vercelSet(API, 'DIRECT_URL', direct)
  ghSecret('DATABASE_URL_PROD', direct)
  worker.DATABASE_URL = null
}
if (parts.has('redis')) {
  for (const project of [API, WEB]) {
    vercelSet(project, 'REDIS_URL', prod.REDIS_URL)
    vercelSet(project, 'UPSTASH_REDIS_REST_TOKEN', prod.UPSTASH_REDIS_REST_TOKEN)
  }
  worker.REDIS_URL = prod.REDIS_URL
}
if (parts.has('analytics')) {
  vercelSet(API, 'ANALYTICS_ID_SECRET', prod.ANALYTICS_ID_SECRET)
  worker.ANALYTICS_ID_SECRET = prod.ANALYTICS_ID_SECRET
}
if (parts.has('supabase')) {
  for (const project of [API, WEB])
    for (const name of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ])
      vercelSet(project, name, prod[name])
  worker.SUPABASE_SERVICE_ROLE_KEY = prod.SUPABASE_SERVICE_ROLE_KEY
}
if (Object.keys(worker).length) await northflank(worker, workerSnapshot)

if (redeploy) {
  for (const project of [API, WEB]) {
    const list = execFileSync(vercelBin, ['ls', project, '--prod', '--scope', SCOPE], {
      cwd: '/tmp',
      encoding: 'utf8',
    })
    const url = list.match(/https:\/\/\S+\.vercel\.app/)?.[0]
    if (!url) throw new Error(`no production deployment found for ${project}`)
    execFileSync(
      vercelBin,
      [
        'redeploy',
        url,
        '--environment',
        'production',
        '--scope',
        SCOPE,
        '--non-interactive',
      ],
      {
        cwd: '/tmp',
        stdio: ['ignore', 'ignore', 'inherit'],
      }
    )
    console.log(`${project}: redeployed`)
  }
}
console.log('done')
