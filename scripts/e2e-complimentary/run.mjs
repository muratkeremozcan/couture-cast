// Learning path Step 54: Complimentary full access.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-54-complimentary-full-access
// Story 6.14 TEA (TEA-15): the complimentary access E2E on its own runtime.
//
// The shared local E2E stack seeds every member flag true and runs specs in parallel
// against one database, so a "flags off globally" proof cannot live there. This runner
// owns one UUID-named database for one Playwright run: it creates it, hands the stack
// its URL and its own ports, runs only complimentary-access.spec.ts with one worker,
// and drops the database whatever happened. The stack's launcher migrates and seeds
// the empty database itself; the spec turns the six member flags off after the seed.
//
// It never touches the default database: the name is checked against the pattern below
// before any statement runs, and the Playwright teardown's db:reset is skipped by
// PLAYWRIGHT_SKIP_DB_RESET=true.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { localDatabaseUrl } from '../lib/local-supabase-ports.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const COMPLIMENTARY_E2E_DATABASE = /^tea_cc614_e2e_[a-f0-9]{32}$/

/** The server the stack's Postgres runs on: local Supabase, on its configured port. */
const source = new URL(
  process.env.COMPLIMENTARY_E2E_SOURCE_DATABASE_URL ??
    process.env.LOCAL_DATABASE_URL ??
    (process.env.CI ? process.env.DATABASE_URL : undefined) ??
    localDatabaseUrl()
)
if (!['127.0.0.1', 'localhost'].includes(source.hostname))
  throw new Error('The complimentary E2E runs only against a loopback Postgres.')

const name = `tea_cc614_e2e_${randomUUID().replaceAll('-', '')}`
if (!COMPLIMENTARY_E2E_DATABASE.test(name)) throw new Error('unexpected database name')
const target = new URL(source)
target.pathname = `/${name}`

async function admin(work) {
  const client = new pg.Client({ connectionString: source.toString() })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

async function create() {
  await admin((client) => client.query(`CREATE DATABASE "${name}" TEMPLATE template0`))
  const client = new pg.Client({ connectionString: target.toString() })
  await client.connect()
  try {
    // The auth.jwt contract and client grants pr-checks.yml gives a fresh database, and
    // the three auth.users columns the operator command reads to resolve its admin.
    // Supabase's real auth schema lives in the default database only; the stack signs
    // members in with the local E2E bearer, so no other auth table is needed.
    await client.query(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $fn$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb);
    `)
  } finally {
    await client.end()
  }
}

async function drop() {
  await admin((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`))
}

const API = 'http://127.0.0.1:4079'
const WEB = 'http://127.0.0.1:3079'
const WEATHER = '4089'
const owned = {
  NODE_ENV: 'test',
  TEST_ENV: 'local',
  DATABASE_URL: target.toString(),
  DIRECT_URL: target.toString(),
  LOCAL_DATABASE_URL: target.toString(),
  COMPLIMENTARY_E2E_DATABASE_URL: target.toString(),
  PORT: '4079',
  API_BASE_URL: API,
  API_LISTEN_HOST: '127.0.0.1',
  PUBLIC_API_URL: API,
  WEB_E2E_BASE_URL: WEB,
  HTTP_CORS_ORIGIN: WEB,
  WEB_NEXT_DIST_DIR: '.next-complimentary',
  E2E_WEATHER_DOUBLE_PORT: WEATHER,
  WEATHER_PROVIDER_TEST_DOUBLE_PORT: WEATHER,
  OPENWEATHER_API_ORIGIN: `http://127.0.0.1:${WEATHER}`,
  WEATHERAPI_API_ORIGIN: `http://127.0.0.1:${WEATHER}`,
  MODERATION_OPS_CAPTURE_PORT: '4339',
  COMMUNITY_FLAG_FIXTURE_MODE: 'true',
  COMMUNITY_SCREENING_EVIDENCE_MODE: 'fixture',
  COMMUNITY_NSFW_SCREENER: 'fixture',
  GARMENT_TAGGING_ENGINE: 'fixture',
  PLAYWRIGHT_SKIP_DB_RESET: 'true',
  PLAYWRIGHT_DB_RESET: 'false',
  POSTHOG_API_KEY: '',
}
owned.E2E_CALLER_OWNED_ENV_KEYS = Object.keys(owned).sort().join(',')

function playwright() {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      [
        'playwright',
        'test',
        '--config',
        'playwright/config/complimentary.config.ts',
        ...process.argv.slice(2),
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          ...owned,
          COMPLIMENTARY_E2E_OWNED_ENV: JSON.stringify(owned),
        },
      }
    )
    const forward = (signal) => child.kill(signal)
    process.on('SIGINT', forward)
    process.on('SIGTERM', forward)
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

let code = 1
try {
  await create()
  console.log(`[e2e-complimentary] owned database ${name}`)
  code = await playwright()
} finally {
  await drop().catch((error) =>
    console.error(`[e2e-complimentary] drop ${name} failed: ${error.message}`)
  )
  console.log(`[e2e-complimentary] dropped ${name}`)
}
process.exit(code)
