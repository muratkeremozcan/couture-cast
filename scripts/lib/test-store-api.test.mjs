// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  journeyApi,
  readEnvValue,
  requireEnvValue,
  waitForServerState,
} from './test-store-api.mjs'
import { MOBILE_E2E_TOKEN_MARKER } from './mobile-e2e-token.mjs'
import { assertServerPaid } from './test-store-journey.mjs'

function envFile(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-store-env-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, '.env.local')
  fs.writeFileSync(file, text)
  return file
}

test('env values are read by name; a missing one names the variable and file, never a value', (t) => {
  const file = envFile(t, 'PRESENT=fixture-value\nEMPTY=\n')
  assert.equal(readEnvValue(file, 'PRESENT'), 'fixture-value')
  assert.equal(readEnvValue(file, 'EMPTY'), undefined)
  assert.equal(readEnvValue('/nonexistent/.env', 'PRESENT'), undefined)
  assert.throws(
    () => requireEnvValue(file, 'EMPTY'),
    (error) =>
      error.code === 'test_store_env_missing' &&
      error.message.includes('EMPTY') &&
      !error.message.includes('fixture-value')
  )
})

const json = (status, body) => ({ ok: status < 300, status, json: async () => body })

test('signup makes a mobile E2E bearer for the new member; every call carries the bypass header', async () => {
  const calls = []
  const api = journeyApi({
    origin: 'https://api.example.test',
    headers: { 'x-vercel-protection-bypass': 'fixture' },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/signup')) return json(201, { userId: 'user-1' })
      if (String(url).endsWith('/refresh')) return json(503, {})
      return json(200, { data: { status: 'none' } })
    },
  })
  const member = await api.signup()
  assert.equal(member.userId, 'user-1')
  const [, payload, marker] = member.token.split('.')
  assert.equal(marker, MOBILE_E2E_TOKEN_MARKER)
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).sub, 'user-1')
  assert.deepEqual(await api.subscription(member.token), { status: 'none' })
  assert.deepEqual(await api.refresh(member.token), { status: 503 })
  assert.ok(
    calls.every((call) => call.init.headers['x-vercel-protection-bypass'] === 'fixture')
  )
  assert.equal(calls[1].init.headers.authorization, `Bearer ${member.token}`)
  assert.match(JSON.parse(calls[0].init.body).email, /^test-store-.+@example\.com$/)
})

test('a failed signup is a coded failure', async () => {
  const api = journeyApi({
    origin: 'http://x.test',
    fetchImpl: async () => json(500, {}),
  })
  await assert.rejects(api.signup(), (error) => error.code === 'test_store_signup_failed')
})

test('waitForServerState polls until the paid state holds, then times out with the last status', async () => {
  let reads = 0
  const states = ['none', 'none', 'active']
  const api = {
    subscription: async () => {
      const status = states[Math.min(reads++, states.length - 1)]
      return status === 'active'
        ? { status, store: 'test_store', productId: 'premium_monthly' }
        : { status }
    },
    access: async () =>
      reads >= 3
        ? { premium: true, source: 'subscription' }
        : { premium: false, source: 'none' },
  }
  let clock = 0
  const accept = (state) => {
    assertServerPaid(state)
    return true
  }
  const options = {
    api,
    token: 't',
    accept,
    now: () => clock,
    sleep: async (ms) => (clock += ms),
  }
  const state = await waitForServerState({
    ...options,
    timeoutMs: 60_000,
    intervalMs: 1_000,
  })
  assert.equal(state.subscription.status, 'active')
  assert.equal(reads, 3)

  const never = {
    subscription: async () => ({ status: 'none' }),
    access: async () => ({}),
  }
  clock = 0
  await assert.rejects(
    waitForServerState({ ...options, api: never, timeoutMs: 5_000, intervalMs: 1_000 }),
    (error) => error.code === 'test_store_server_not_entitled'
  )
})
