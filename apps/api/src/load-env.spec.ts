// Learning path Step 9: Observability bootstrap with OpenTelemetry.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-9-observability-bootstrap-with-opentelemetry
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { afterEach, describe, expect, it, vi } from 'vitest'

const loadEnvMock = vi.fn()
const existsSyncMock = vi.fn((target: string) => target.endsWith('.env.local'))

vi.mock('dotenv', () => ({
  config: loadEnvMock,
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}))

describe('load-env', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.NODE_ENV
    delete process.env.TEST_ENV
    delete process.env.POSTHOG_API_KEY
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
})
