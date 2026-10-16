import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { waitForDeploymentWithSha } from '../../../scripts/resolve-vercel-preview-url.mjs'

const expectedSha = 'bd339289e00c95ba24f320fd095b4d81a753bf98'
const stale = {
  url: 'couture-cast-stale.vercel.app',
  meta: { githubCommitSha: '058b82912e07' },
}
const fresh = {
  url: 'couture-cast-fresh.vercel.app',
  meta: { githubCommitSha: expectedSha },
}

describe('waitForDeploymentWithSha', () => {
  beforeEach(() => {
    process.env.RESOLVE_SHA_INTERVAL_SECONDS = '0'
    process.env.RESOLVE_SHA_TIMEOUT_SECONDS = '1'
  })

  afterEach(() => {
    delete process.env.RESOLVE_SHA_INTERVAL_SECONDS
    delete process.env.RESOLVE_SHA_TIMEOUT_SECONDS
  })

  it('keeps polling past a stale deployment until the expected commit is listed', async () => {
    const listings = [[stale], [stale], [fresh, stale]]
    let calls = 0
    const url = await waitForDeploymentWithSha(
      () => Promise.resolve(listings[Math.min(calls++, listings.length - 1)] ?? []),
      expectedSha.slice(0, 7)
    )

    expect(url).toBe('https://couture-cast-fresh.vercel.app')
    expect(calls).toBe(3)
  })

  it('never returns another commit when the expected one does not appear in time', async () => {
    process.env.RESOLVE_SHA_TIMEOUT_SECONDS = '0.05'
    const url = await waitForDeploymentWithSha(
      () => Promise.resolve([stale]),
      expectedSha
    )

    expect(url).toBeUndefined()
  })
})
