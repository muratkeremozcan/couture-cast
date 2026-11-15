#!/usr/bin/env node
/**
 * Story 6.17 H-SETTINGS and H-AUTHORIZE: the hosted Supabase Auth settings Google sign-in relies
 * on, read with the public anon key only (no login, no Management API).
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=... node scripts/ci/supabase-auth-config-probe.mjs
 *
 * Exits 1 with one line per broken invariant:
 * - Google is enabled and email sign-in still is.
 * - Keycloak (the local E2E stand-in, D10) is off.
 * - `mailer_autoconfirm` is false. With it on, GoTrue confirms an unverified provider address
 *   and links it to the existing account with that address (spike S0), so a Google account
 *   holding an unverified copy of someone's address would sign in as them.
 * - `/auth/v1/authorize?provider=google` answers 302 to accounts.google.com with a client id and
 *   `redirect_uri` equal to this project's `/auth/v1/callback`, and asks for no scope beyond
 *   `email` and `profile` (OpenID is implied).
 * It prints no key, token or client secret; the client id is shown by its first 12 characters.
 */
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** @param {unknown} settings */
export function settingsProblems(settings) {
  const problems = []
  const record = /** @type {Record<string, unknown>} */ (
    settings && typeof settings === 'object' ? settings : {}
  )
  const external = /** @type {Record<string, unknown>} */ (
    record.external && typeof record.external === 'object' ? record.external : {}
  )
  if (external.google !== true) problems.push('external.google is not true')
  if (external.email !== true) problems.push('external.email is not true')
  if (external.keycloak !== false) problems.push('external.keycloak is not false')
  if (record.mailer_autoconfirm !== false)
    problems.push('mailer_autoconfirm is not false')
  return problems
}

const ALLOWED_SCOPES = new Set(['openid', 'email', 'profile'])

/**
 * @param {{ status: number; location: string | null }} response
 * @param {string} supabaseUrl
 */
export function authorizeProblems(response, supabaseUrl) {
  if (response.status !== 302 || !response.location)
    return [`authorize answered ${response.status} without a redirect`]
  const target = new URL(response.location)
  const problems = []
  if (target.origin !== 'https://accounts.google.com')
    problems.push(`authorize redirects to ${target.origin}`)
  const clientId = target.searchParams.get('client_id') ?? ''
  if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId))
    problems.push('client_id is not a Google OAuth client id')
  const callback = new URL(
    '/auth/v1/callback',
    `${supabaseUrl.replace(/\/$/, '')}/`
  ).toString()
  if (target.searchParams.get('redirect_uri') !== callback)
    problems.push('redirect_uri is not this project callback')
  const scopes = (target.searchParams.get('scope') ?? '').split(/[\s+]+/).filter(Boolean)
  for (const scope of scopes)
    if (!ALLOWED_SCOPES.has(scope)) problems.push(`unexpected scope ${scope}`)
  return problems
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) {
    console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required.')
    process.exit(2)
  }
  const headers = { apikey: anonKey }
  const settings = await fetch(new URL('/auth/v1/settings', supabaseUrl), { headers })
  const problems = settingsProblems(settings.ok ? await settings.json() : {})
  if (!settings.ok) problems.unshift(`settings answered ${settings.status}`)
  const authorize = await fetch(
    new URL('/auth/v1/authorize?provider=google&redirect_to=', supabaseUrl),
    { headers, redirect: 'manual' }
  )
  problems.push(
    ...authorizeProblems(
      { status: authorize.status, location: authorize.headers.get('location') },
      supabaseUrl
    )
  )
  const host = new URL(supabaseUrl).host
  if (problems.length > 0) {
    for (const problem of problems) console.error(`${host}: ${problem}`)
    process.exit(1)
  }
  const clientId = new URL(authorize.headers.get('location') ?? '').searchParams.get(
    'client_id'
  )
  console.log(
    `${host}: Google sign-in configuration holds (client ${clientId?.slice(0, 12)}…).`
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  await main()
