import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listDeploymentsAwaitingSha } from '../../../scripts/resolve-api-preview-url.mjs'

const expectedSha = 'bd339289e00c95ba24f320fd095b4d81a753bf98'
const stale = {
  url: 'couture-cast-stale.vercel.app',
  meta: { githubCommitSha: '058b82912e07' },
}
const fresh = {
  url: 'couture-cast-fresh.vercel.app',
  meta: { githubCommitSha: expectedSha },
}

describe('listDeploymentsAwaitingSha', () => {
  beforeEach(() => {
    process.env.RESOLVE_SHA_INTERVAL_SECONDS = '0'
    process.env.RESOLVE_SHA_TIMEOUT_SECONDS = '1'
  })

  afterEach(() => {
    delete process.env.RESOLVE_SHA_INTERVAL_SECONDS
    delete process.env.RESOLVE_SHA_TIMEOUT_SECONDS
  })

  it('retries a failed request and polls until the expected commit is listed', async () => {
    let calls = 0
    const listing = () => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('HTTP 429'))
      return Promise.resolve(calls < 3 ? [stale] : [fresh, stale])
    }

    const deployments = await listDeploymentsAwaitingSha(listing, expectedSha, true)

    expect(deployments).toEqual([fresh, stale])
    expect(calls).toBe(3)
  })

  it('lists once without polling when no explicit commit was requested', async () => {
    let calls = 0
    const deployments = await listDeploymentsAwaitingSha(
      () => {
        calls += 1
        return Promise.resolve([stale])
      },
      expectedSha,
      false
    )

    expect(deployments).toEqual([stale])
    expect(calls).toBe(1)
  })
})
