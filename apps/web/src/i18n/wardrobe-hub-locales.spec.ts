// Story CC-7.9 D9: the web Wardrobe tab's member-facing strings (wardrobe.hub.*), moved out of
// apps/web/src/app/wardrobe/page.tsx into all 10 web catalogs.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { supportedLocales } from '@couture/api-client/contracts/http'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './index'

type HubCatalog = Record<string, unknown> & { status?: Record<string, string> }

const REQUIRED_KEYS = [
  'loading',
  'emptyTitle',
  'emptyBody',
  'emptyAction',
  'accountFailed',
  'accountFailedShort',
  'setupFailed',
  'addGarment',
  'closetTitle',
  'closetBody',
  'needsTags',
  'taggingSlow',
  'statusRefreshFailed',
  'refreshFailed',
  'silhouetteSaving',
  'detailTitle',
] as const

/** Every garment status the contract lists today (an open set; unknown ones read as is). */
const STATUS_KEYS = [
  'pending_upload',
  'bytes_uploaded',
  'processing',
  'awaiting_tags',
  'ready',
  'failed',
] as const

const hubOf = (locale: string) =>
  (
    JSON.parse(
      fs.readFileSync(new URL(`./locales/${locale}.json`, import.meta.url), 'utf8')
    ) as { wardrobe?: { hub?: HubCatalog } }
  ).wardrobe?.hub

const catalogs = SUPPORTED_LOCALES.map((locale) => ({ locale, hub: hubOf(locale) }))
const baseline = catalogs.find((item) => item.locale === DEFAULT_LOCALE)!.hub!

describe('wardrobe.hub catalog (web)', () => {
  it('covers all 10 supported locales', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual([...supportedLocales].sort())
    expect(catalogs).toHaveLength(10)
  })

  it.each(catalogs)('$locale has every wardrobe.hub key, non-empty', ({ hub }) => {
    expect(hub).toBeDefined()
    expect(Object.keys(hub!).sort()).toEqual([...REQUIRED_KEYS, 'status'].sort())
    expect(Object.keys(hub!.status!).sort()).toEqual([...STATUS_KEYS].sort())

    const values = [
      ...REQUIRED_KEYS.map((key) => hub![key]),
      ...STATUS_KEYS.map((key) => hub!.status![key]),
    ]
    for (const value of values) {
      expect(typeof value).toBe('string')
      expect((value as string).trim().length).toBeGreaterThan(0)
      expect(value).not.toContain('wardrobe.hub.')
      expect(value).not.toMatch(/\{\{|\}\}/)
    }
  })

  it.each(catalogs.filter(({ locale }) => !locale.startsWith('en-')))(
    '$locale translates every wardrobe.hub string',
    ({ locale, hub }) => {
      for (const key of REQUIRED_KEYS) {
        expect(hub![key], `${locale}.wardrobe.hub.${key}`).not.toBe(baseline[key])
      }
      for (const key of STATUS_KEYS) {
        expect(hub!.status![key], `${locale}.wardrobe.hub.status.${key}`).not.toBe(
          baseline.status![key]
        )
      }
    }
  )
})
