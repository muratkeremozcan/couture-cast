#!/usr/bin/env node
// Provisions the one persistent synthetic member the production E2E lane signs in as, and checks
// it. Run by an operator, never by CI: it needs the Supabase admin key from the gitignored
// .env.prod, a credential no GitHub secret holds.
//
//   node scripts/ops/provision-prod-synthetic-member.mjs            check only, writes nothing
//   node scripts/ops/provision-prod-synthetic-member.mjs --apply    create or repair the member
//   node scripts/ops/provision-prod-synthetic-member.mjs --apply --push-secrets
//                                                                  and store the lane's inputs
//
// What the lane receives: one GitHub secret, the member's password, and three GitHub variables
// that are not secret (the member's address, the Supabase URL and its publishable key).
// With those the lane signs in through Supabase's password grant, which yields a session for this
// one member only. The admin key never leaves the operator's machine.
//
// The member is an ordinary adult account: an app User through the public signup endpoint, and a
// Supabase Auth user with a confirmed address and a password. Nothing marks it in the app's own
// tables; its address (`synthetic-prod-member@example.com`) is how an operator recognizes it.
// The password lives in .env.prod (PROD_SYNTHETIC_MEMBER_PASSWORD, generated on first --apply).
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SYNTHETIC_MEMBER_EMAIL = 'synthetic-prod-member@example.com'
const BIRTHDATE = '1990-06-15'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply') || args.has('--push-secrets')
const pushSecrets = args.has('--push-secrets')
const unknown = [...args].filter((a) => !['--apply', '--push-secrets'].includes(a))
if (unknown.length) {
  console.error(`unknown argument: ${unknown.join(' ')}`)
  process.exit(1)
}

// A worktree has no .env.prod of its own (it is gitignored): ENV_PROD_FILE names the checkout's.
const ENV_FILE = process.env.ENV_PROD_FILE ?? path.join(REPO, '.env.prod')

function readEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

const env = readEnv(ENV_FILE)
for (const name of [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'PROD_API_BASE_URL',
]) {
  if (!env[name]) {
    console.error(`.env.prod has no ${name}`)
    process.exit(1)
  }
}
const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, '')
const adminKey = env.SUPABASE_SERVICE_ROLE_KEY
const publishableKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const apiBase = env.PROD_API_BASE_URL.replace(/\/$/, '')

let password = env.PROD_SYNTHETIC_MEMBER_PASSWORD
if (!password) {
  if (!apply) {
    console.log('no password yet: --apply generates one into .env.prod')
  } else {
    password = randomBytes(24).toString('base64url')
    appendFileSync(ENV_FILE, `\nPROD_SYNTHETIC_MEMBER_PASSWORD=${password}\n`)
    console.log('generated PROD_SYNTHETIC_MEMBER_PASSWORD into .env.prod')
  }
}

const adminHeaders = {
  apikey: adminKey,
  authorization: `Bearer ${adminKey}`,
  'content-type': 'application/json',
}

async function findAuthUser() {
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
      {
        headers: adminHeaders,
      }
    )
    if (!response.ok) throw new Error(`Auth admin list answered ${response.status}`)
    const { users } = await response.json()
    const found = users.find((u) => u.email?.toLowerCase() === SYNTHETIC_MEMBER_EMAIL)
    if (found) return found
    if (users.length < 200) return undefined
  }
  return undefined
}

async function ensureAppAccount() {
  const response = await fetch(`${apiBase}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: SYNTHETIC_MEMBER_EMAIL, birthdate: BIRTHDATE }),
  })
  // 400 "Email already registered" is the repeat run.
  if (response.status === 201) return 'created'
  if (response.status === 400) return 'exists'
  throw new Error(`App signup answered ${response.status}`)
}

async function ensureAuthUser() {
  const existing = await findAuthUser()
  if (!existing) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        email: SYNTHETIC_MEMBER_EMAIL,
        password,
        email_confirm: true,
      }),
    })
    if (!response.ok) throw new Error(`Auth admin create answered ${response.status}`)
    return 'created'
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${existing.id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ password, email_confirm: true }),
  })
  if (!response.ok) throw new Error(`Auth admin update answered ${response.status}`)
  return 'repaired'
}

/** Signs in as the member the way the lane does, and reads its profile through the API. */
async function verifyLaneSignIn() {
  const grant = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: SYNTHETIC_MEMBER_EMAIL, password }),
  })
  if (!grant.ok) return `password sign-in answered ${grant.status}`
  const session = await grant.json()
  const profile = await fetch(`${apiBase}/api/v1/user/profile`, {
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'x-couture-platform': 'web',
    },
  })
  if (!profile.ok) return `profile check answered ${profile.status}`
  const body = await profile.json()
  const address = body?.data?.user?.email ?? body?.user?.email
  return address?.toLowerCase() === SYNTHETIC_MEMBER_EMAIL
    ? 'ok'
    : 'profile names another member'
}

function gh(command, name, value) {
  const result = spawnSync('gh', [command, 'set', name], {
    input: value,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`gh ${command} set ${name} failed`)
  console.log(`set ${command} ${name}`)
}

const authUser = await findAuthUser()
console.log(`auth user: ${authUser ? 'present' : 'missing'}`)
if (apply) {
  console.log(`app account: ${await ensureAppAccount()}`)
  console.log(`auth user: ${await ensureAuthUser()}`)
}
if (password) {
  const verdict = await verifyLaneSignIn()
  console.log(`lane sign-in: ${verdict}`)
  if (verdict !== 'ok') process.exit(1)
}
if (pushSecrets) {
  gh('variable', 'PROD_SYNTHETIC_MEMBER_EMAIL', SYNTHETIC_MEMBER_EMAIL)
  gh('secret', 'PROD_SYNTHETIC_MEMBER_PASSWORD', password)
  gh('variable', 'PROD_SUPABASE_URL', supabaseUrl)
  gh('variable', 'PROD_SUPABASE_PUBLISHABLE_KEY', publishableKey)
}
