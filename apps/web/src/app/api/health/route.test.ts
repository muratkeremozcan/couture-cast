import { afterEach, expect, it, vi } from 'vitest'
import { GET } from './route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

it('reports serving commit metadata and a live timestamp on the health endpoint', async () => {
  vi.stubEnv('BUILD_GIT_SHA', 'fixture-commit')
  vi.stubEnv('BUILD_GIT_BRANCH', 'fixture-branch')
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('VERCEL_URL', 'couturecast.example.test')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T17:25:00.000Z'))

  const response = GET()

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  await expect(response.json()).resolves.toEqual({
    status: 'ok',
    service: 'couturecast-web',
    environment: 'production',
    gitSha: 'fixture-commit',
    gitBranch: 'fixture-branch',
    deployUrl: 'https://couturecast.example.test',
    timestamp: '2026-11-20T17:25:00.000Z',
  })
})
