import { describe, expect, it, vi } from 'vitest'
import {
  DNS_LABEL_MAX,
  deterministicBranchAliasUrl,
  gitBranchAliasForDeployment,
  pickGitBranchAlias,
} from '../../../scripts/vercel-branch-alias.mjs'

const TEAM = 'muratkeremozcans-projects'
// Read from Vercel on 2026-11-03: the alias of a deployment on feat/cc-6-10-moderator-queue.
const HASHED_ALIAS = `couture-cast-api-git-feat-cc-6-b6bedf-${TEAM}.vercel.app`

describe('deterministicBranchAliasUrl', () => {
  it('builds the alias of a branch whose label fits a DNS label', () => {
    expect(deterministicBranchAliasUrl('couture-cast-web', 'main', TEAM)).toBe(
      `https://couture-cast-web-git-main-${TEAM}.vercel.app`
    )
  })

  it('gives no URL when the label passes 63 characters, since Vercel shortens it and adds a hash', () => {
    const label = `couture-cast-api-git-feat-cc-6-10-moderator-queue-${TEAM}`
    expect(label.length).toBe(75)
    expect(label.length).toBeGreaterThan(DNS_LABEL_MAX)
    expect(
      deterministicBranchAliasUrl(
        'couture-cast-api',
        'feat-cc-6-10-moderator-queue',
        TEAM
      )
    ).toBeUndefined()
  })

  it('accepts a label of exactly 63 characters', () => {
    const branch = 'b'.repeat(DNS_LABEL_MAX - `x-git--${TEAM}`.length)
    expect(deterministicBranchAliasUrl('x', branch, TEAM)).toBe(
      `https://x-git-${branch}-${TEAM}.vercel.app`
    )
    expect(deterministicBranchAliasUrl('x', `${branch}b`, TEAM)).toBeUndefined()
  })

  it('gives no URL when a part is missing', () => {
    expect(deterministicBranchAliasUrl(undefined, 'main', TEAM)).toBeUndefined()
    expect(deterministicBranchAliasUrl('x', '', TEAM)).toBeUndefined()
    expect(deterministicBranchAliasUrl('x', 'main', undefined)).toBeUndefined()
  })
})

describe('pickGitBranchAlias', () => {
  it('takes the git-branch alias and adds the scheme', () => {
    expect(pickGitBranchAlias(['couture-cast-abc.vercel.app', HASHED_ALIAS])).toBe(
      `https://${HASHED_ALIAS}`
    )
  })

  it('returns undefined without a git-branch alias or a list', () => {
    expect(pickGitBranchAlias(['couture-cast.vercel.app'])).toBeUndefined()
    expect(pickGitBranchAlias(undefined)).toBeUndefined()
    expect(pickGitBranchAlias([null, 3])).toBeUndefined()
  })
})

describe('gitBranchAliasForDeployment', () => {
  it('asks Vercel for the aliases when the deployment list left them out', async () => {
    const fetchAliases = vi.fn(() => Promise.resolve([HASHED_ALIAS]))
    const url = await gitBranchAliasForDeployment(
      { uid: 'dpl_2s8wHVwMzozcuaVojQ6Jht4Zx6nG' },
      fetchAliases
    )
    expect(url).toBe(`https://${HASHED_ALIAS}`)
    expect(fetchAliases).toHaveBeenCalledWith('dpl_2s8wHVwMzozcuaVojQ6Jht4Zx6nG')
  })

  it('uses the aliases the deployment already carries without a request', async () => {
    const fetchAliases = vi.fn(() => Promise.resolve([]))
    const url = await gitBranchAliasForDeployment({ alias: [HASHED_ALIAS] }, fetchAliases)
    expect(url).toBe(`https://${HASHED_ALIAS}`)
    expect(fetchAliases).not.toHaveBeenCalled()
  })

  it('returns undefined for a deployment with no id and no alias', async () => {
    const fetchAliases = vi.fn(() => Promise.resolve([HASHED_ALIAS]))
    expect(await gitBranchAliasForDeployment({}, fetchAliases)).toBeUndefined()
    expect(fetchAliases).not.toHaveBeenCalled()
  })
})
