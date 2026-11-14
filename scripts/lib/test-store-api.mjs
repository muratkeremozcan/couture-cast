// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15: the journey's own calls to our API (local or preview), and the env-file reads
// it needs. Members are made the way the Expo Go harness makes them (run-maestro.mjs): a public
// signup, then the TEST_ENV-gated mobile E2E bearer for that user id, which the local and
// preview APIs accept and the app honors only in a `__DEV__` bundle.
//
// Secrets are read by name and handed straight to a header or a child env; nothing here prints,
// logs or returns one.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { parse } from 'dotenv'
import { buildMobileE2EAccessToken } from './mobile-e2e-token.mjs'
import { JourneyError, readData } from './test-store-journey.mjs'

/** One variable from a dotenv file, or undefined. The value is never echoed. */
export function readEnvValue(file, name) {
  if (!file || !fs.existsSync(file)) return undefined
  const value = parse(fs.readFileSync(file))[name]?.trim()
  return value ? value : undefined
}

/** A required variable; the error names the variable and the file, never a value. */
export function requireEnvValue(file, name) {
  const value = readEnvValue(file, name)
  if (!value) throw new JourneyError('test_store_env_missing', `${name} in ${file}`)
  return value
}

/** The client the driver uses. `headers` go on every call (the preview bypass header). */
export function journeyApi({ origin, headers = {}, fetchImpl = fetch }) {
  const call = (path, { token, method = 'GET', body } = {}) =>
    fetchImpl(new URL(path, origin), {
      method,
      headers: {
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  return {
    async health() {
      const response = await call('/api/health')
      if (!response.ok)
        throw new JourneyError('test_store_api_unreachable', String(response.status))
    },
    /** A fresh member; returns { userId, token }. */
    async signup() {
      const response = await call('/api/v1/auth/signup', {
        method: 'POST',
        body: {
          email: `test-store-${randomUUID()}@example.com`,
          birthdate: '2000-01-15',
        },
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || typeof body?.userId !== 'string' || !body.userId)
        throw new JourneyError('test_store_signup_failed', String(response.status))
      return { userId: body.userId, token: buildMobileE2EAccessToken(body.userId) }
    },
    subscription: async (token) =>
      readData(await call('/api/v1/commerce/subscription', { token }), 'subscription'),
    access: async (token) =>
      readData(
        await call('/api/v1/commerce/premium/access', { token }),
        'premium/access'
      ),
    /** The ledger pull; the status tells a configured ledger (200) from none (503). */
    async refresh(token) {
      const response = await call('/api/v1/commerce/subscription/refresh', {
        method: 'POST',
        token,
      })
      return { status: response.status }
    },
  }
}

/** Both server reads for a member. */
export async function serverState(api, token) {
  const [subscription, access] = await Promise.all([
    api.subscription(token),
    api.access(token),
  ])
  return { subscription, access }
}

/**
 * Polls the server reads until `accept(state)` returns true. Resolves to the accepted state, or
 * rejects with the last state's failure once `timeoutMs` has passed.
 */
export async function waitForServerState({
  api,
  token,
  accept,
  timeoutMs = 120_000,
  intervalMs = 3_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = now() + timeoutMs
  for (;;) {
    const state = await serverState(api, token)
    try {
      if (accept(state)) return state
    } catch (error) {
      if (now() >= deadline) throw error
    }
    if (now() >= deadline)
      throw new JourneyError('test_store_server_wait_timeout', state.subscription?.status)
    await sleep(intervalMs)
  }
}
