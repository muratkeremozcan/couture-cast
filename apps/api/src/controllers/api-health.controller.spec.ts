import { describe, expect, it, vi, afterEach } from 'vitest'

import { ApiHealthController } from './api-health.controller'

describe('ApiHealthController', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns API health metadata for preview/deployment waiters', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_URL', 'api-preview.example.vercel.app')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123def456')
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'feat/preview-test')

    const controller = new ApiHealthController()
    const response = controller.getHealth()

    expect(response.status).toBe('ok')
    expect(response.service).toBe('couturecast-api')
    expect(response.environment).toBe('preview')
    expect(response.gitSha).toBe('abc123def456')
    expect(response.gitBranch).toBe('feat/preview-test')
    expect(response.deployUrl).toBe('https://api-preview.example.vercel.app')
    expect(typeof response.timestamp).toBe('string')
  })
})
