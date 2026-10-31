// Learning path Step 9: Observability bootstrap with OpenTelemetry.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-9-observability-bootstrap-with-opentelemetry
// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadEnvKeepingCallerOwned } from '../../../scripts/lib/caller-owned-env.mjs'

const loadEnvMock = vi.fn()
const existsSyncMock = vi.fn()

vi.mock('dotenv', () => ({
  config: loadEnvMock,
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}))

describe('load-env', () => {
  beforeEach(() => {
    // Explicit default, reapplied fresh before every test, rather than a
    // baked-in `vi.fn(impl)` factory implementation relied on forever:
    // `mockReset()` (via `resetAllMocks()`) wipes a mock's implementation
    // back to a no-op, not just its call history, so a test-3/test-4
    // `mockImplementation` override needs to be undone here rather than
    // left to `afterEach` to leave the next test with the right default.
    loadEnvMock.mockReset()
    existsSyncMock
      .mockReset()
      .mockImplementation((target: string) => target.endsWith('.env.local'))
  })

  afterEach(() => {
    vi.resetModules()
    delete process.env.NODE_ENV
    delete process.env.TEST_ENV
    delete process.env.POSTHOG_API_KEY
    delete process.env.E2E_CALLER_OWNED_ENV_KEYS
    delete process.env.CC12B_TEST_DATABASE_URL
  })

  it('loads root .env files in expected precedence order for development', async () => {
    await import('#load-env')

    expect(existsSyncMock).toHaveBeenCalled()
    expect(loadEnvMock).toHaveBeenCalledTimes(1)
    expect(loadEnvMock.mock.calls[0]?.[0]).toMatchObject({
      override: false,
      quiet: true,
    })
    expect(String(loadEnvMock.mock.calls[0]?.[0]?.path)).toContain('.env.local')
  })

  it('lets .env.local override inherited values for TEST_ENV=local', async () => {
    process.env.TEST_ENV = 'local'

    await import('#load-env')

    expect(loadEnvMock).toHaveBeenCalledTimes(1)
    expect(loadEnvMock.mock.calls[0]?.[0]).toMatchObject({
      override: true,
      quiet: true,
    })
    expect(String(loadEnvMock.mock.calls[0]?.[0]?.path)).toContain('.env.local')
  })

  it('preserves an explicit empty-string var against the .env.local override', async () => {
    // Regression test: the local Playwright harness sets POSTHOG_API_KEY=''
    // to keep feature-flag reads on the seeded/cached fallback rather than
    // live PostHog. .env.local commonly carries a real key for manual local
    // dev, so the override above must not silently win back over this run's
    // explicit disable -- simulated here by having the mocked loader do what
    // the real dotenv override would: write a real value into process.env.
    process.env.TEST_ENV = 'local'
    process.env.POSTHOG_API_KEY = ''
    loadEnvMock.mockImplementation(() => {
      process.env.POSTHOG_API_KEY = 'phc_a-real-local-dev-key'
    })

    await import('#load-env')

    expect(process.env.POSTHOG_API_KEY).toBe('')
  })

  it('checks the production env file when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    existsSyncMock.mockImplementation((target: string) => target.endsWith('.env.prod'))

    await import('#load-env')

    expect(loadEnvMock).toHaveBeenCalledTimes(1)
    expect(String(loadEnvMock.mock.calls[0]?.[0]?.path)).toContain('.env.prod')
  })

  it('keeps the values the E2E launcher marked caller-owned against the .env.local override', async () => {
    // Story 1.2b: an isolated DATABASE_URL reached the launcher's seed step while
    // the API it spawned wrote to whatever .env.local named.
    process.env.TEST_ENV = 'local'
    process.env.CC12B_TEST_DATABASE_URL = 'postgresql://isolated/test'
    process.env.E2E_CALLER_OWNED_ENV_KEYS = 'CC12B_TEST_DATABASE_URL, MISSING_KEY'
    loadEnvMock.mockImplementation(() => {
      process.env.CC12B_TEST_DATABASE_URL = 'postgresql://default/postgres'
    })

    await import('#load-env')

    expect(process.env.CC12B_TEST_DATABASE_URL).toBe('postgresql://isolated/test')
    expect(process.env.MISSING_KEY).toBeUndefined()
  })
})

// Story 1.2b R22: the migrate wrapper and the Playwright environment loader
// share scripts/lib/caller-owned-env.mjs, which the Nest build cannot import,
// so load-env keeps its own copy of the caller-owned rule. Both copies get the
// same cases here and must agree, so neither can drift alone.
describe('load-env caller-owned rule matches scripts/lib/caller-owned-env.mjs', () => {
  type ParityCase = {
    inherited: Record<string, string>
    owned: string
    envLocal: Record<string, string>
  }
  const KEYS = ['CC12B_PARITY_A', 'CC12B_PARITY_B', 'CC12B_PARITY_C']
  const cases: [string, ParityCase][] = [
    [
      'keeps every listed key that holds a value',
      {
        inherited: { CC12B_PARITY_A: 'caller-a', CC12B_PARITY_B: 'caller-b' },
        owned: 'CC12B_PARITY_A,CC12B_PARITY_B',
        envLocal: { CC12B_PARITY_A: 'local-a', CC12B_PARITY_B: 'local-b' },
      },
    ],
    [
      'lets .env.local win for a key the caller did not list',
      {
        inherited: { CC12B_PARITY_A: 'caller-a', CC12B_PARITY_B: 'caller-b' },
        owned: 'CC12B_PARITY_A',
        envLocal: { CC12B_PARITY_A: 'local-a', CC12B_PARITY_B: 'local-b' },
      },
    ],
    [
      'trims names and ignores blanks and listed keys with no value',
      {
        inherited: { CC12B_PARITY_A: 'caller-a' },
        owned: ' CC12B_PARITY_A , ,CC12B_PARITY_C',
        envLocal: { CC12B_PARITY_A: 'local-a', CC12B_PARITY_C: 'local-c' },
      },
    ],
    [
      'keeps a listed key that .env.local does not define',
      {
        inherited: { CC12B_PARITY_B: 'caller-b' },
        owned: 'CC12B_PARITY_B',
        envLocal: { CC12B_PARITY_A: 'local-a' },
      },
    ],
    [
      'changes nothing without a list',
      {
        inherited: { CC12B_PARITY_A: 'caller-a' },
        owned: '',
        envLocal: { CC12B_PARITY_A: 'local-a', CC12B_PARITY_C: 'local-c' },
      },
    ],
  ]

  const snapshot = (env: NodeJS.ProcessEnv) =>
    Object.fromEntries(KEYS.map((key) => [key, env[key]]))

  beforeEach(() => {
    loadEnvMock.mockReset()
    existsSyncMock
      .mockReset()
      .mockImplementation((target: string) => target.endsWith('.env.local'))
  })

  afterEach(() => {
    vi.resetModules()
    delete process.env.TEST_ENV
    delete process.env.E2E_CALLER_OWNED_ENV_KEYS
    for (const key of KEYS) delete process.env[key]
  })

  it.each(cases)('%s', async (_name, { inherited, owned, envLocal }) => {
    const shared: NodeJS.ProcessEnv = { ...inherited, E2E_CALLER_OWNED_ENV_KEYS: owned }
    loadEnvKeepingCallerOwned(() => Object.assign(shared, envLocal), shared)

    process.env.TEST_ENV = 'local'
    Object.assign(process.env, inherited, { E2E_CALLER_OWNED_ENV_KEYS: owned })
    // The mocked loader does what the real .env.local override does.
    loadEnvMock.mockImplementation(() => {
      Object.assign(process.env, envLocal)
    })
    await import('#load-env')

    expect(snapshot(process.env)).toEqual(snapshot(shared))
  })
})
