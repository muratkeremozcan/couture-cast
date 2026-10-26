import { describe, expect, it } from 'vitest'
import { supportedLocales } from '@couture/api-client/contracts/http'
import development from '../../../test/fixtures/community-text-corpus/development-v3.json'
import { loadCommunityScreeningPolicy } from './community-screening-policy.js'
import { CommunityTextScreener } from './community-text-screener.js'

const loaded = loadCommunityScreeningPolicy()
const screener = new CommunityTextScreener({
  policy: loaded.policy.text,
  policyVersion: loaded.identity.textEngineVersion,
})

describe.each(development.entries)('independent development context: $id', (row) => {
  it.each(supportedLocales)(
    'passes ordinary context with all dictionaries under %s',
    (locale) => {
      const result = screener.screen({ text: row.text, field: 'caption', locale })
      expect(result.disposition).toBe('pass')
      expect(result.categories).toEqual([])
      expect(result.screenedLanguages).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt', 'tr'])
    }
  )

  it('continues screening the ambiguous word outside the complete ordinary phrase', () => {
    for (const text of [row.ambiguousToken, `${row.text} ${row.ambiguousToken}`])
      expect(
        screener.screen({ text, field: 'caption', locale: row.locale }).disposition
      ).not.toBe('pass')
  })

  it.each(['fuck', 'f u c k', 'f.u.c.k'])(
    'retains independent screening of %s beside ordinary copy',
    (suffix) => {
      const result = screener.screen({
        text: `${row.text} ${suffix}`,
        field: 'caption',
        locale: row.locale,
      })
      expect(result.disposition).not.toBe('pass')
    }
  )
})
