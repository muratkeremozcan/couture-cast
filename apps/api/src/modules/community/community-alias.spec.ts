// Learning path Step 38: Community feed by climate band.
import { describe, expect, it } from 'vitest'
import { generateCommunityAuthorAlias } from './community-alias'

describe('generateCommunityAuthorAlias', () => {
  it('mints eight hex characters of randomness', () => {
    // Four characters of an unkeyed sha256 gave 65,536 rainbow-checkable buckets
    // over an enumerable input, and collided at roughly three hundred authors,
    // well inside the story's thousand-viewer beta.
    expect(generateCommunityAuthorAlias()).toMatch(/^Style Explorer [0-9A-F]{8}$/)
  })

  it('is not derived from anything, so it cannot be inverted to an author', () => {
    const first = generateCommunityAuthorAlias()
    const second = generateCommunityAuthorAlias()

    expect(first).not.toBe(second)
  })

  it('produces no duplicates across a beta-sized population', () => {
    // The `CommunityAlias.alias` unique constraint is the real guarantee; this
    // checks the generator is wide enough that the constraint is a formality
    // rather than a retry loop.
    const aliases = new Set(
      Array.from({ length: 2_000 }, () => generateCommunityAuthorAlias())
    )
    expect(aliases.size).toBe(2_000)
  })
})
