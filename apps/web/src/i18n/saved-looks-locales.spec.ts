// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './index'

type SavedLooksCatalog = Record<string, string>

const REQUIRED_KEYS = [
  'title',
  'count',
  'empty',
  'reopen',
  'remove',
  'missingPiece',
  'missingPieceDetail',
  'needsReview',
  'needsReviewDetail',
  'photoUnavailable',
  'loadFailed',
  'retry',
  'detailTitle',
  'sourceStylePiece',
  'sourceHomeSample',
  'slotOrderLabel',
  'close',
  'showList',
  'hideList',
] as const

const json = (relative: string) =>
  JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8')) as {
    savedLooks?: SavedLooksCatalog
  }

const catalogs = SUPPORTED_LOCALES.map((locale) => ({
  locale,
  web: json(`./locales/${locale}.json`).savedLooks!,
  mobile: json(`../../../mobile/assets/locales/${locale}.json`).savedLooks!,
}))

const baseline = catalogs.find((item) => item.locale === DEFAULT_LOCALE)!

describe('saved-looks catalog parity (web)', () => {
  it('covers all 10 supported locales', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual([...supportedLocales].sort())
    expect(catalogs).toHaveLength(10)
  })

  it.each(catalogs)(
    '$locale has every required savedLooks key matching web and mobile',
    ({ locale, web, mobile }) => {
      expect(web).toBeDefined()
      expect(mobile).toBeDefined()
      expect(Object.keys(web).sort()).toEqual([...REQUIRED_KEYS].sort())
      expect(web).toEqual(mobile)

      for (const key of REQUIRED_KEYS) {
        const value = web[key]
        expect(typeof value).toBe('string')
        expect(value!.trim().length).toBeGreaterThan(0)
        expect(value).not.toContain('savedLooks.')
      }

      if (!locale.startsWith('en-')) {
        for (const key of REQUIRED_KEYS) {
          expect(web[key], `${locale}.${key} should be translated`).not.toBe(
            baseline.web[key]
          )
        }
      }
    }
  )
})
