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

  it('checks the production env file when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    existsSyncMock.mockImplementation((target: string) => target.endsWith('.env.prod'))

    await import('#load-env')

    expect(loadEnvMock).toHaveBeenCalledTimes(1)
    expect(String(loadEnvMock.mock.calls[0]?.[0]?.path)).toContain('.env.prod')
  })
})
