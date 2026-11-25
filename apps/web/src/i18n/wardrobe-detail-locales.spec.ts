// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
// Learning path Step 64: Garment delete (wardrobe.detail.delete* keys).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './index'

type DetailCatalog = Record<string, string>

const REQUIRED_KEYS = [
  'back',
  'category',
  'material',
  'comfort',
  'noMaterial',
  'editTags',
  'done',
  'cancel',
  'noChanges',
  'conflict',
  'notAllowed',
  'undoFailed',
  'missing',
  'loading',
  'loadFailed',
  'delete',
  'deleteConfirmTitle_one',
  'deleteConfirmTitle_other',
  'deleteConfirmAccept',
  'deleteCancel',
  'deleteSucceeded',
  'deleteUndone',
  'deleteFailed',
  'deleteUsageFailed',
] as const

const PLURAL_KEYS = REQUIRED_KEYS.filter((key) => /_(one|other)$/.test(key))
const PLAIN_KEYS = REQUIRED_KEYS.filter((key) => !PLURAL_KEYS.includes(key))

const json = (relative: string) =>
  JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8')) as {
    wardrobe?: { detail?: DetailCatalog }
  }

const catalogs = SUPPORTED_LOCALES.map((locale) => ({
  locale,
  web: json(`./locales/${locale}.json`).wardrobe?.detail,
  mobile: json(`../../../mobile/assets/locales/${locale}.json`).wardrobe?.detail,
}))

const baseline = catalogs.find((item) => item.locale === DEFAULT_LOCALE)!

describe('wardrobe.detail catalog parity (web)', () => {
  it('covers all 10 supported locales', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual([...supportedLocales].sort())
    expect(catalogs).toHaveLength(10)
  })

  it.each(catalogs)(
    '$locale has every wardrobe.detail key, matching web and mobile',
    ({ locale, web, mobile }) => {
      expect(web).toBeDefined()
      expect(mobile).toBeDefined()
      expect(Object.keys(web!).sort()).toEqual([...REQUIRED_KEYS].sort())
      expect(web).toEqual(mobile)

      for (const key of REQUIRED_KEYS) {
        const value = web![key]
        expect(typeof value).toBe('string')
        expect(value!.trim().length).toBeGreaterThan(0)
        expect(value).not.toContain('wardrobe.detail.')
      }
      for (const key of PLAIN_KEYS) {
        expect(web![key]).not.toMatch(/\{\{|\}\}/)
      }
      // Plural forms interpolate the count and nothing else.
      for (const key of PLURAL_KEYS) {
        expect(web![key]).toContain('{{count}}')
        expect(web![key]!.replace('{{count}}', '')).not.toMatch(/\{\{|\}\}/)
      }

      if (!locale.startsWith('en-')) {
        for (const key of REQUIRED_KEYS) {
          expect(web![key], `${locale}.${key} should be translated`).not.toBe(
            baseline.web![key]
          )
        }
      }
    }
  )
})
